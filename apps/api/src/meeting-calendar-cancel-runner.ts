import { Prisma } from '@prisma/client';
import type { AutomationEventEnvelopeV1 } from './domain/automation-engine-v1.js';
import {
  MicrosoftGraphCalendarClient,
  MicrosoftGraphCalendarConfigurationError,
  MicrosoftGraphCalendarError,
} from './microsoft-graph-calendar-client.js';
import { withTenant } from './tenant-transaction.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ATTEMPTS = 4;

type CancellationRow = {
  id: string;
  meeting_object_id: string;
  organizer_graph_user: string;
  graph_event_id: string | null;
  lifecycle_status: 'SCHEDULED' | 'CANCEL_PENDING' | 'CANCELLED';
  cancellation_comment: string | null;
  last_cancel_event_id: string | null;
};

export interface MeetingCalendarCancelResultV2 {
  handled: boolean;
  cancelled: boolean;
  retryableFailure: boolean;
  terminal: boolean;
}

function collaborationIdFromEvent(event: AutomationEventEnvelopeV1): string | null {
  if (event.eventType !== 'bridata.meeting.m365.cancel.requested') return null;
  const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
    ? event.payload as Record<string, unknown>
    : {};
  const value = typeof payload.collaborationId === 'string' ? payload.collaborationId : null;
  return value && UUID_RE.test(value) ? value : null;
}

export async function processMeetingCalendarCancelEventV2(
  event: AutomationEventEnvelopeV1,
  graph: MicrosoftGraphCalendarClient,
  deliveryCount = 1,
): Promise<MeetingCalendarCancelResultV2> {
  const collaborationId = collaborationIdFromEvent(event);
  if (!collaborationId) return { handled: false, cancelled: false, retryableFailure: false, terminal: true };
  const sourceEventId = UUID_RE.test(event.eventId) ? event.eventId : null;

  const prepared = await withTenant(event.tenantId, async (tx) => {
    const rows = await tx.$queryRaw<CancellationRow[]>(Prisma.sql`
      SELECT id, meeting_object_id, organizer_graph_user, graph_event_id,
             lifecycle_status, cancellation_comment, last_cancel_event_id
      FROM meeting_collaboration_v1
      WHERE tenant_id = ${event.tenantId}::uuid AND id = ${collaborationId}::uuid
      FOR UPDATE
    `);
    const row = rows[0];
    if (!row) return { kind: 'missing' as const };
    if (row.lifecycle_status === 'CANCELLED' && sourceEventId && row.last_cancel_event_id === sourceEventId) {
      return { kind: 'already-cancelled' as const };
    }
    if (!row.graph_event_id) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE meeting_collaboration_v1
        SET lifecycle_status = 'CANCELLED'::"MeetingLifecycleStatusV2",
            sync_status = 'LOCAL_ONLY'::"MeetingM365SyncStatusV1",
            cancelled_at = COALESCE(cancelled_at, CURRENT_TIMESTAMP),
            last_cancel_event_id = ${sourceEventId}::uuid,
            sync_error = NULL,
            join_url = NULL,
            web_link = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${event.tenantId}::uuid AND id = ${collaborationId}::uuid
      `);
      return { kind: 'local-only' as const };
    }
    return { kind: 'ready' as const, row };
  });

  if (prepared.kind === 'missing') return { handled: true, cancelled: false, retryableFailure: false, terminal: true };
  if (prepared.kind === 'already-cancelled' || prepared.kind === 'local-only') {
    return { handled: true, cancelled: true, retryableFailure: false, terminal: true };
  }

  try {
    await graph.cancelEvent(
      prepared.row.organizer_graph_user,
      prepared.row.graph_event_id!,
      prepared.row.cancellation_comment,
    );

    await withTenant(event.tenantId, async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        UPDATE meeting_collaboration_v1
        SET lifecycle_status = 'CANCELLED'::"MeetingLifecycleStatusV2",
            sync_status = 'SYNCED'::"MeetingM365SyncStatusV1",
            cancelled_at = COALESCE(cancelled_at, CURRENT_TIMESTAMP),
            last_cancel_event_id = ${sourceEventId}::uuid,
            sync_error = NULL,
            join_url = NULL,
            web_link = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${event.tenantId}::uuid AND id = ${collaborationId}::uuid
      `);
      await tx.auditLog.create({
        data: {
          tenantId: event.tenantId,
          userId: null,
          action: 'MEETING_M365_CANCELLED',
          resource: 'MEETING_COLLABORATION_V1',
          resourceId: collaborationId,
          details: { meetingObjectId: prepared.row.meeting_object_id, sourceEventId },
        },
      });
    });
    return { handled: true, cancelled: true, retryableFailure: false, terminal: true };
  } catch (error) {
    const configurationError = error instanceof MicrosoftGraphCalendarConfigurationError;
    const graphError = error instanceof MicrosoftGraphCalendarError ? error : null;
    const retryable = !configurationError && deliveryCount < MAX_ATTEMPTS && (graphError ? graphError.retryable : true);
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 8000);
    await withTenant(event.tenantId, async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        UPDATE meeting_collaboration_v1
        SET lifecycle_status = 'CANCEL_PENDING'::"MeetingLifecycleStatusV2",
            sync_status = 'FAILED'::"MeetingM365SyncStatusV1",
            sync_error = ${message},
            updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${event.tenantId}::uuid AND id = ${collaborationId}::uuid
      `);
    });
    return { handled: true, cancelled: false, retryableFailure: retryable, terminal: !retryable };
  }
}
