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

export interface MeetingCalendarSyncResultV1 {
  handled: boolean;
  synced: boolean;
  retryableFailure: boolean;
  terminal: boolean;
}

type MeetingSyncRow = {
  id: string;
  meeting_object_id: string;
  organizer_graph_user: string;
  start_at: Date;
  end_at: Date;
  location: string | null;
  is_online: boolean;
  graph_event_id: string | null;
  sync_status: 'LOCAL_ONLY' | 'PENDING' | 'SYNCED' | 'FAILED';
  title: string;
  description: string | null;
};

type AttendeeRow = { email: string; display_name: string; attendee_type: 'REQUIRED' | 'OPTIONAL' };

function collaborationIdFromEvent(event: AutomationEventEnvelopeV1): string | null {
  if (event.eventType !== 'bridata.meeting.m365.sync.requested') return null;
  const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
    ? event.payload as Record<string, unknown>
    : {};
  const value = typeof payload.collaborationId === 'string' ? payload.collaborationId : null;
  return value && UUID_RE.test(value) ? value : null;
}

export async function processMeetingCalendarSyncEventV1(
  event: AutomationEventEnvelopeV1,
  graph: MicrosoftGraphCalendarClient,
  deliveryCount = 1,
): Promise<MeetingCalendarSyncResultV1> {
  const collaborationId = collaborationIdFromEvent(event);
  if (!collaborationId) return { handled: false, synced: false, retryableFailure: false, terminal: true };

  const prepared = await withTenant(event.tenantId, async (tx) => {
    const rows = await tx.$queryRaw<MeetingSyncRow[]>(Prisma.sql`
      SELECT c.id, c.meeting_object_id, c.organizer_graph_user, c.start_at, c.end_at, c.location,
             c.is_online, c.graph_event_id, c.sync_status, o.title, o.description
      FROM meeting_collaboration_v1 c
      JOIN nexus_objects o ON o.id = c.meeting_object_id AND o.deleted_at IS NULL
      WHERE c.tenant_id = ${event.tenantId}::uuid AND c.id = ${collaborationId}::uuid
      FOR UPDATE OF c
    `);
    const row = rows[0];
    if (!row) return { kind: 'missing' as const };
    const attendees = await tx.$queryRaw<AttendeeRow[]>(Prisma.sql`
      SELECT email, display_name, attendee_type
      FROM meeting_collaboration_attendees_v1
      WHERE tenant_id = ${event.tenantId}::uuid AND meeting_collaboration_id = ${row.id}::uuid
      ORDER BY created_at, id
    `);
    await tx.$executeRaw(Prisma.sql`
      UPDATE meeting_collaboration_v1
      SET sync_status = 'PENDING'::"MeetingM365SyncStatusV1",
          last_sync_attempt_at = CURRENT_TIMESTAMP,
          sync_error = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${event.tenantId}::uuid AND id = ${row.id}::uuid
    `);
    return { kind: 'ready' as const, row, attendees };
  });

  if (prepared.kind === 'missing') return { handled: true, synced: false, retryableFailure: false, terminal: true };

  try {
    const input = {
      collaborationId,
      organizerGraphUser: prepared.row.organizer_graph_user,
      subject: prepared.row.title,
      body: prepared.row.description,
      startAt: prepared.row.start_at,
      endAt: prepared.row.end_at,
      location: prepared.row.location,
      attendees: prepared.attendees.map((attendee) => ({
        email: attendee.email,
        displayName: attendee.display_name,
        type: attendee.attendee_type === 'OPTIONAL' ? 'optional' as const : 'required' as const,
      })),
      isOnline: prepared.row.is_online,
    };
    const result = prepared.row.graph_event_id
      ? await graph.updateEvent(prepared.row.graph_event_id, input)
      : await graph.createEvent(input);

    await withTenant(event.tenantId, async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        UPDATE meeting_collaboration_v1
        SET sync_status = 'SYNCED'::"MeetingM365SyncStatusV1",
            graph_event_id = ${result.id},
            graph_change_key = ${result.changeKey},
            join_url = ${result.joinUrl},
            web_link = ${result.webLink},
            last_synced_at = CURRENT_TIMESTAMP,
            sync_error = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${event.tenantId}::uuid AND id = ${collaborationId}::uuid
      `);
      await tx.auditLog.create({ data: {
        tenantId: event.tenantId,
        userId: null,
        action: 'MEETING_M365_SYNCED',
        resource: 'MEETING_COLLABORATION_V1',
        resourceId: collaborationId,
        details: { meetingObjectId: prepared.row.meeting_object_id, graphEventId: result.id, hasJoinUrl: Boolean(result.joinUrl) },
      } });
    });
    return { handled: true, synced: true, retryableFailure: false, terminal: true };
  } catch (error) {
    const configurationError = error instanceof MicrosoftGraphCalendarConfigurationError;
    const graphError = error instanceof MicrosoftGraphCalendarError ? error : null;
    const retryable = !configurationError && deliveryCount < MAX_ATTEMPTS && (graphError ? graphError.retryable : true);
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 8000);
    await withTenant(event.tenantId, async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        UPDATE meeting_collaboration_v1
        SET sync_status = 'FAILED'::"MeetingM365SyncStatusV1",
            sync_error = ${message},
            updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${event.tenantId}::uuid AND id = ${collaborationId}::uuid
      `);
    });
    return { handled: true, synced: false, retryableFailure: retryable, terminal: !retryable };
  }
}
