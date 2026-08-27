import { Prisma } from '@prisma/client';
import type { AutomationEventEnvelopeV1 } from './domain/automation-engine-v1.js';
import { toGraphRecurrenceV1, type MeetingRecurrenceRuleV1 } from './domain/meeting-recurrence-v1.js';
import {
  MicrosoftGraphCalendarClient,
  MicrosoftGraphCalendarConfigurationError,
  MicrosoftGraphCalendarError,
} from './microsoft-graph-calendar-client.js';
import { withTenant } from './tenant-transaction.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ATTEMPTS = 4;

export interface MeetingCalendarSyncResultV1 {
  handled: boolean;
  synced: boolean;
  retryableFailure: boolean;
  terminal: boolean;
}

type MeetingSyncRow = {
  id: string; meeting_object_id: string; organizer_graph_user: string; start_at: Date; end_at: Date; location: string | null;
  is_online: boolean; graph_event_id: string | null; sync_status: 'LOCAL_ONLY'|'PENDING'|'SYNCED'|'FAILED';
  lifecycle_status: 'SCHEDULED'|'CANCEL_PENDING'|'CANCELLED'; last_synced_event_id: string | null; title: string; description: string | null;
};
type AttendeeRow = { email: string; display_name: string; attendee_type: 'REQUIRED'|'OPTIONAL' };
type ResourceRow = { email: string; name: string; resource_type: 'ROOM'|'EQUIPMENT' };
type RecurrenceRow = {
  pattern_type: 'DAILY'|'WEEKLY'|'ABSOLUTE_MONTHLY'; interval: number; days_of_week: string[]; day_of_month: number|null;
  range_type: 'NUMBERED'|'END_DATE'; range_start_date: Date; range_end_date: Date|null; number_of_occurrences: number|null; timezone: 'America/Lima';
};

function collaborationIdFromEvent(event: AutomationEventEnvelopeV1): string | null {
  if (event.eventType !== 'bridata.meeting.m365.sync.requested') return null;
  const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) ? event.payload as Record<string, unknown> : {};
  const value = typeof payload.collaborationId === 'string' ? payload.collaborationId : null;
  return value && UUID_RE.test(value) ? value : null;
}
function safeEventId(event: AutomationEventEnvelopeV1): string | null { return UUID_RE.test(event.eventId) ? event.eventId : null; }
function dateOnly(value: Date): string { return value.toISOString().slice(0, 10); }

export async function processMeetingCalendarSyncEventV1(
  event: AutomationEventEnvelopeV1,
  graph: MicrosoftGraphCalendarClient,
  deliveryCount = 1,
): Promise<MeetingCalendarSyncResultV1> {
  const collaborationId = collaborationIdFromEvent(event);
  if (!collaborationId) return { handled: false, synced: false, retryableFailure: false, terminal: true };
  const sourceEventId = safeEventId(event);

  const prepared = await withTenant(event.tenantId, async (tx) => {
    const rows = await tx.$queryRaw<MeetingSyncRow[]>(Prisma.sql`
      SELECT c.id, c.meeting_object_id, c.organizer_graph_user, c.start_at, c.end_at, c.location,
             c.is_online, c.graph_event_id, c.sync_status, c.lifecycle_status, c.last_synced_event_id,
             o.title, o.description
      FROM meeting_collaboration_v1 c
      JOIN nexus_objects o ON o.id = c.meeting_object_id AND o.deleted_at IS NULL
      WHERE c.tenant_id = ${event.tenantId}::uuid AND c.id = ${collaborationId}::uuid
      FOR UPDATE OF c
    `);
    const row = rows[0];
    if (!row) return { kind: 'missing' as const };
    if (row.lifecycle_status !== 'SCHEDULED') return { kind: 'lifecycle-blocked' as const, row };
    if (sourceEventId && row.sync_status === 'SYNCED' && row.last_synced_event_id === sourceEventId) return { kind: 'already-synced' as const, row };

    const attendees = await tx.$queryRaw<AttendeeRow[]>(Prisma.sql`
      SELECT email, display_name, attendee_type FROM meeting_collaboration_attendees_v1
      WHERE tenant_id = ${event.tenantId}::uuid AND meeting_collaboration_id = ${row.id}::uuid ORDER BY created_at, id
    `);
    const recurrenceRows = await tx.$queryRaw<RecurrenceRow[]>(Prisma.sql`
      SELECT pattern_type, interval, days_of_week, day_of_month, range_type, range_start_date, range_end_date, number_of_occurrences, timezone
      FROM meeting_recurrence_series_v1
      WHERE tenant_id=${event.tenantId}::uuid AND meeting_collaboration_id=${row.id}::uuid LIMIT 1
    `);
    const resources = await tx.$queryRaw<ResourceRow[]>(Prisma.sql`
      SELECT DISTINCT r.email, r.name, r.resource_type
      FROM meeting_resources_v1 r
      JOIN (
        SELECT b.meeting_resource_id
        FROM meeting_resource_bookings_v1 b
        WHERE b.tenant_id=${event.tenantId}::uuid AND b.meeting_collaboration_id=${row.id}::uuid
        UNION
        SELECT rb.meeting_resource_id
        FROM meeting_occurrence_resource_bookings_v1 rb
        JOIN meeting_recurrence_occurrences_v1 occ ON occ.id=rb.occurrence_id AND occ.tenant_id=rb.tenant_id
        JOIN meeting_recurrence_series_v1 s ON s.id=occ.series_id AND s.tenant_id=occ.tenant_id
        WHERE rb.tenant_id=${event.tenantId}::uuid AND s.meeting_collaboration_id=${row.id}::uuid
      ) bookings ON bookings.meeting_resource_id=r.id
      WHERE r.tenant_id=${event.tenantId}::uuid
      ORDER BY r.resource_type, r.name
    `);

    await tx.$executeRaw(Prisma.sql`
      UPDATE meeting_collaboration_v1
      SET sync_status='PENDING'::"MeetingM365SyncStatusV1", last_sync_attempt_at=CURRENT_TIMESTAMP, sync_error=NULL, updated_at=CURRENT_TIMESTAMP
      WHERE tenant_id=${event.tenantId}::uuid AND id=${row.id}::uuid
    `);
    return { kind: 'ready' as const, row, attendees, resources, recurrence: recurrenceRows[0] ?? null };
  });

  if (prepared.kind === 'missing' || prepared.kind === 'lifecycle-blocked') return { handled: true, synced: false, retryableFailure: false, terminal: true };
  if (prepared.kind === 'already-synced') return { handled: true, synced: true, retryableFailure: false, terminal: true };

  try {
    const attendeeMap = new Map<string, { email:string; displayName:string; type:'required'|'optional'|'resource' }>();
    for (const attendee of prepared.attendees) attendeeMap.set(attendee.email.trim().toLowerCase(), { email:attendee.email, displayName:attendee.display_name, type:attendee.attendee_type==='OPTIONAL'?'optional':'required' });
    for (const resource of prepared.resources) attendeeMap.set(resource.email.trim().toLowerCase(), { email:resource.email, displayName:resource.name, type:'resource' });

    let recurrence: Record<string, unknown> | undefined;
    if (prepared.recurrence) {
      const rule: MeetingRecurrenceRuleV1 = {
        patternType: prepared.recurrence.pattern_type,
        interval: prepared.recurrence.interval,
        daysOfWeek: prepared.recurrence.days_of_week as MeetingRecurrenceRuleV1['daysOfWeek'],
        dayOfMonth: prepared.recurrence.day_of_month ?? undefined,
        rangeType: prepared.recurrence.range_type,
        numberOfOccurrences: prepared.recurrence.number_of_occurrences ?? undefined,
        endDate: prepared.recurrence.range_end_date ? dateOnly(prepared.recurrence.range_end_date) : undefined,
        timezone: 'America/Lima',
      };
      recurrence = toGraphRecurrenceV1(rule, dateOnly(prepared.recurrence.range_start_date));
    }

    const input = {
      collaborationId,
      organizerGraphUser: prepared.row.organizer_graph_user,
      subject: prepared.row.title,
      body: prepared.row.description,
      startAt: prepared.row.start_at,
      endAt: prepared.row.end_at,
      location: prepared.row.location,
      attendees: [...attendeeMap.values()],
      isOnline: prepared.row.is_online,
      recurrence,
    };
    const result = prepared.row.graph_event_id ? await graph.updateEvent(prepared.row.graph_event_id, input) : await graph.createEvent(input);

    await withTenant(event.tenantId, async (tx) => {
      const state = await tx.$queryRaw<Array<{ lifecycle_status:string }>>(Prisma.sql`
        SELECT lifecycle_status FROM meeting_collaboration_v1 WHERE tenant_id=${event.tenantId}::uuid AND id=${collaborationId}::uuid FOR UPDATE
      `);
      if (state[0]?.lifecycle_status !== 'SCHEDULED') return;
      await tx.$executeRaw(Prisma.sql`
        UPDATE meeting_collaboration_v1
        SET sync_status='SYNCED'::"MeetingM365SyncStatusV1", graph_event_id=${result.id}, graph_change_key=${result.changeKey},
            join_url=${result.joinUrl}, web_link=${result.webLink}, last_synced_at=CURRENT_TIMESTAMP,
            last_synced_event_id=${sourceEventId}::uuid, sync_error=NULL, updated_at=CURRENT_TIMESTAMP
        WHERE tenant_id=${event.tenantId}::uuid AND id=${collaborationId}::uuid
      `);
      await tx.auditLog.create({ data: {
        tenantId:event.tenantId,userId:null,action:'MEETING_M365_SYNCED',resource:'MEETING_COLLABORATION_V1',resourceId:collaborationId,
        details:{meetingObjectId:prepared.row.meeting_object_id,graphEventId:result.id,hasJoinUrl:Boolean(result.joinUrl),sourceEventId,attendeeCount:prepared.attendees.length,resourceCount:prepared.resources.length,recurringSeries:Boolean(prepared.recurrence)}
      }});
    });
    return { handled:true, synced:true, retryableFailure:false, terminal:true };
  } catch (error) {
    const configurationError = error instanceof MicrosoftGraphCalendarConfigurationError;
    const graphError = error instanceof MicrosoftGraphCalendarError ? error : null;
    const retryable = !configurationError && deliveryCount < MAX_ATTEMPTS && (graphError ? graphError.retryable : true);
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 8000);
    await withTenant(event.tenantId, async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        UPDATE meeting_collaboration_v1
        SET sync_status=CASE WHEN lifecycle_status='SCHEDULED'::"MeetingLifecycleStatusV2" THEN 'FAILED'::"MeetingM365SyncStatusV1" ELSE sync_status END,
            sync_error=CASE WHEN lifecycle_status='SCHEDULED'::"MeetingLifecycleStatusV2" THEN ${message} ELSE sync_error END,
            updated_at=CURRENT_TIMESTAMP
        WHERE tenant_id=${event.tenantId}::uuid AND id=${collaborationId}::uuid
      `);
    });
    return { handled:true, synced:false, retryableFailure:retryable, terminal:!retryable };
  }
}
