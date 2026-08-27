import { Prisma } from '@prisma/client';
import type { AutomationEventEnvelopeV1 } from './domain/automation-engine-v1.js';
import type { MeetingCalendarSyncResultV1 } from './meeting-calendar-sync-runner.js';
import {
  MicrosoftGraphCalendarClient,
  MicrosoftGraphCalendarConfigurationError,
  MicrosoftGraphCalendarError,
} from './microsoft-graph-calendar-client.js';
import { withTenant } from './tenant-transaction.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ATTEMPTS = 4;

type EventKind = 'sync' | 'cancel';
type OccurrenceRow = {
  id:string; series_id:string; original_start_at:Date; start_at:Date; end_at:Date; lifecycle_status:'SCHEDULED'|'CANCEL_PENDING'|'CANCELLED';
  graph_event_id:string|null; cancellation_comment:string|null; meeting_collaboration_id:string; master_meeting_object_id:string;
  organizer_graph_user:string; graph_series_master_id:string|null; series_lifecycle_status:'SCHEDULED'|'CANCEL_PENDING'|'CANCELLED'; location:string|null;
};

function parseEvent(event: AutomationEventEnvelopeV1): { kind:EventKind; occurrenceId:string } | null {
  let kind: EventKind | null = null;
  if (event.eventType === 'bridata.meeting.recurrence.occurrence.sync.requested') kind = 'sync';
  if (event.eventType === 'bridata.meeting.recurrence.occurrence.cancel.requested') kind = 'cancel';
  if (!kind) return null;
  const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) ? event.payload as Record<string,unknown> : {};
  const occurrenceId = typeof payload.occurrenceId === 'string' && UUID_RE.test(payload.occurrenceId) ? payload.occurrenceId : null;
  return occurrenceId ? { kind, occurrenceId } : null;
}

async function resolveGraphOccurrenceId(graph: MicrosoftGraphCalendarClient, row: OccurrenceRow): Promise<string | null> {
  if (row.graph_event_id) return row.graph_event_id;
  if (!row.graph_series_master_id) return null;
  const start = new Date(row.original_start_at.getTime() - 5 * 60 * 1000);
  const end = new Date(row.original_start_at.getTime() + 5 * 60 * 1000);
  const instances = await graph.listInstances(row.organizer_graph_user, row.graph_series_master_id, start, end);
  const exact = instances.find((instance) => Math.abs(instance.startAt.getTime() - row.original_start_at.getTime()) <= 60_000);
  return exact?.id ?? null;
}

export async function processRecurringOccurrenceEventV1(
  event: AutomationEventEnvelopeV1,
  graph: MicrosoftGraphCalendarClient,
  deliveryCount = 1,
): Promise<MeetingCalendarSyncResultV1> {
  const parsed = parseEvent(event);
  if (!parsed) return { handled:false,synced:false,retryableFailure:false,terminal:true };

  const row = await withTenant(event.tenantId, async (tx) => {
    const rows = await tx.$queryRaw<OccurrenceRow[]>(Prisma.sql`
      SELECT o.id,o.series_id,o.original_start_at,o.start_at,o.end_at,o.lifecycle_status,o.graph_event_id,o.cancellation_comment,
             s.meeting_collaboration_id,s.master_meeting_object_id,c.organizer_graph_user,c.graph_event_id AS graph_series_master_id,
             c.lifecycle_status AS series_lifecycle_status,c.location
      FROM meeting_recurrence_occurrences_v1 o
      JOIN meeting_recurrence_series_v1 s ON s.id=o.series_id AND s.tenant_id=o.tenant_id
      JOIN meeting_collaboration_v1 c ON c.id=s.meeting_collaboration_id AND c.tenant_id=s.tenant_id
      WHERE o.tenant_id=${event.tenantId}::uuid AND o.id=${parsed.occurrenceId}::uuid LIMIT 1
    `);
    return rows[0] ?? null;
  });
  if (!row) return { handled:true,synced:false,retryableFailure:false,terminal:true };
  if (row.series_lifecycle_status !== 'SCHEDULED') return { handled:true,synced:false,retryableFailure:false,terminal:true };
  if (parsed.kind === 'sync' && row.lifecycle_status !== 'SCHEDULED') return { handled:true,synced:false,retryableFailure:false,terminal:true };
  if (parsed.kind === 'cancel' && row.lifecycle_status === 'CANCELLED') return { handled:true,synced:true,retryableFailure:false,terminal:true };
  if (parsed.kind === 'cancel' && row.lifecycle_status !== 'CANCEL_PENDING') return { handled:true,synced:false,retryableFailure:false,terminal:true };
  if (!row.graph_series_master_id) {
    const retryable = deliveryCount < MAX_ATTEMPTS;
    return { handled:true,synced:false,retryableFailure:retryable,terminal:!retryable };
  }

  try {
    const graphOccurrenceId = await resolveGraphOccurrenceId(graph, row);
    if (!graphOccurrenceId) {
      const retryable = deliveryCount < MAX_ATTEMPTS;
      return { handled:true,synced:false,retryableFailure:retryable,terminal:!retryable };
    }

    if (parsed.kind === 'sync') {
      await graph.updateOccurrence(row.organizer_graph_user, graphOccurrenceId, { startAt:row.start_at,endAt:row.end_at,location:row.location });
      await withTenant(event.tenantId, async (tx) => {
        await tx.$executeRaw(Prisma.sql`
          UPDATE meeting_recurrence_occurrences_v1 SET graph_event_id=${graphOccurrenceId},is_exception=true,updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=${event.tenantId}::uuid AND id=${row.id}::uuid AND lifecycle_status='SCHEDULED'
        `);
        await tx.auditLog.create({data:{tenantId:event.tenantId,userId:null,action:'RECURRING_OCCURRENCE_M365_SYNCED_V1',resource:'MEETING_RECURRENCE_OCCURRENCE_V1',resourceId:row.id,details:{seriesId:row.series_id,graphOccurrenceId}}});
      });
      return { handled:true,synced:true,retryableFailure:false,terminal:true };
    }

    await graph.cancelEvent(row.organizer_graph_user, graphOccurrenceId, row.cancellation_comment);
    await withTenant(event.tenantId, async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        UPDATE meeting_recurrence_occurrences_v1 SET graph_event_id=${graphOccurrenceId},lifecycle_status='CANCELLED'::"MeetingLifecycleStatusV2",
          cancelled_at=COALESCE(cancelled_at,CURRENT_TIMESTAMP),version=version+1,updated_at=CURRENT_TIMESTAMP
        WHERE tenant_id=${event.tenantId}::uuid AND id=${row.id}::uuid AND lifecycle_status='CANCEL_PENDING'
      `);
      await tx.auditLog.create({data:{tenantId:event.tenantId,userId:null,action:'RECURRING_OCCURRENCE_M365_CANCELLED_V1',resource:'MEETING_RECURRENCE_OCCURRENCE_V1',resourceId:row.id,details:{seriesId:row.series_id,graphOccurrenceId}}});
    });
    return { handled:true,synced:true,retryableFailure:false,terminal:true };
  } catch (error) {
    const configurationError = error instanceof MicrosoftGraphCalendarConfigurationError;
    const graphError = error instanceof MicrosoftGraphCalendarError ? error : null;
    const retryable = !configurationError && deliveryCount < MAX_ATTEMPTS && (graphError ? graphError.retryable : true);
    const message = (error instanceof Error ? error.message : String(error)).slice(0,8000);
    await withTenant(event.tenantId, async (tx) => {
      await tx.auditLog.create({data:{tenantId:event.tenantId,userId:null,action:'RECURRING_OCCURRENCE_M365_FAILED_V1',resource:'MEETING_RECURRENCE_OCCURRENCE_V1',resourceId:row.id,details:{seriesId:row.series_id,operation:parsed.kind,error:message,retryable}}});
    });
    return { handled:true,synced:false,retryableFailure:retryable,terminal:!retryable };
  }
}
