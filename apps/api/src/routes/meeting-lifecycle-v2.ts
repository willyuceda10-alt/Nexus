import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canAccessWorkspace, canManageWorkspace } from '../authorization.js';
import { config } from '../config.js';
import {
  MicrosoftGraphAvailabilityClient,
  MicrosoftGraphAvailabilityConfigurationError,
  MicrosoftGraphAvailabilityError,
} from '../microsoft-graph-availability-client.js';
import { withTenant } from '../tenant-transaction.js';

const uuid = z.string().uuid();
const paramsSchema = z.object({ meetingObjectId: uuid });
const lifecycleQuery = z.object({ workspaceId: uuid, projectId: uuid.optional() });
const rescheduleSchema = z.object({
  version: z.number().int().min(1),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  timezone: z.string().trim().min(1).max(100).default('America/Lima'),
  location: z.string().trim().max(500).nullable().optional(),
  requestM365Sync: z.boolean().default(true),
}).superRefine((value, ctx) => {
  if (value.endAt <= value.startAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endAt'], message: 'endAt must be after startAt' });
  }
  if (value.endAt.getTime() - value.startAt.getTime() > 8 * 60 * 60 * 1000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endAt'], message: 'meeting duration cannot exceed 8 hours' });
  }
});
const cancelSchema = z.object({
  version: z.number().int().min(1),
  comment: z.string().trim().max(2000).nullable().optional(),
});

type LifecycleRow = {
  id: string;
  meeting_object_id: string;
  workspace_id: string;
  project_id: string | null;
  organizer_user_id: string;
  organizer_graph_user: string;
  start_at: Date;
  end_at: Date;
  timezone: string;
  location: string | null;
  graph_event_id: string | null;
  sync_status: 'LOCAL_ONLY' | 'PENDING' | 'SYNCED' | 'FAILED';
  lifecycle_status: 'SCHEDULED' | 'CANCEL_PENDING' | 'CANCELLED';
  cancelled_at: Date | null;
  cancellation_comment: string | null;
  version: number;
};

function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}

function scheduleFree(view: string): boolean {
  return view.length > 0 && [...view].every((value) => value === '0');
}

async function getMeeting(
  tx: Prisma.TransactionClient,
  tenantId: string,
  meetingObjectId: string,
): Promise<LifecycleRow | null> {
  const rows = await tx.$queryRaw<LifecycleRow[]>(Prisma.sql`
    SELECT c.id, c.meeting_object_id, c.workspace_id, c.project_id, c.organizer_user_id,
           c.organizer_graph_user, c.start_at, c.end_at, c.timezone, c.location,
           c.graph_event_id, c.sync_status, c.lifecycle_status, c.cancelled_at,
           c.cancellation_comment, o.version
    FROM meeting_collaboration_v1 c
    JOIN nexus_objects o ON o.id = c.meeting_object_id AND o.deleted_at IS NULL
    WHERE c.tenant_id = ${tenantId}::uuid AND c.meeting_object_id = ${meetingObjectId}::uuid
    LIMIT 1
  `);
  return rows[0] ?? null;
}

export async function meetingLifecycleV2Routes(app: FastifyInstance): Promise<void> {
  const graph = new MicrosoftGraphAvailabilityClient();
  app.addHook('onClose', async () => graph.close());

  app.get('/api/v1/meetings-v2/lifecycle', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const query = lifecycleQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'validation_error', details: query.error.flatten() });
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      if (!(await canAccessWorkspace(tx, actor, query.data.workspaceId))) {
        return reply.code(403).send({ error: 'workspace_access_denied' });
      }
      const rows = await tx.$queryRaw<Array<{
        meeting_object_id: string;
        lifecycle_status: 'SCHEDULED' | 'CANCEL_PENDING' | 'CANCELLED';
        cancelled_at: Date | null;
        cancellation_comment: string | null;
      }>>(Prisma.sql`
        SELECT meeting_object_id, lifecycle_status, cancelled_at, cancellation_comment
        FROM meeting_collaboration_v1
        WHERE tenant_id = ${actor.tenantId}::uuid
          AND workspace_id = ${query.data.workspaceId}::uuid
          AND (${query.data.projectId ?? null}::uuid IS NULL OR project_id = ${query.data.projectId ?? null}::uuid)
        ORDER BY start_at, id
      `);
      return {
        items: rows.map((row) => ({
          meetingObjectId: row.meeting_object_id,
          lifecycleStatus: row.lifecycle_status,
          cancelledAt: row.cancelled_at?.toISOString() ?? null,
          cancellationComment: row.cancellation_comment,
        })),
      };
    });
  });

  app.put('/api/v1/meetings-v2/:meetingObjectId/reschedule', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = rescheduleSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;

    const prepared = await withTenant(actor.tenantId, async (tx) => {
      const meeting = await getMeeting(tx, actor.tenantId, params.data.meetingObjectId);
      if (!meeting) return { kind: 'missing' as const };
      const canManage = await canManageWorkspace(tx, actor, meeting.workspace_id);
      if (!canManage && meeting.organizer_user_id !== actor.userId) return { kind: 'forbidden' as const };
      if (meeting.lifecycle_status !== 'SCHEDULED') return { kind: 'not-scheduled' as const, meeting };
      if (meeting.version !== body.data.version) return { kind: 'version-conflict' as const };

      const attendees = await tx.$queryRaw<Array<{ email: string }>>(Prisma.sql`
        SELECT email FROM meeting_collaboration_attendees_v1
        WHERE tenant_id = ${actor.tenantId}::uuid AND meeting_collaboration_id = ${meeting.id}::uuid
      `);
      const resources = await tx.$queryRaw<Array<{ email: string }>>(Prisma.sql`
        SELECT r.email
        FROM meeting_resource_bookings_v1 b
        JOIN meeting_resources_v1 r ON r.id = b.meeting_resource_id
        WHERE b.tenant_id = ${actor.tenantId}::uuid AND b.meeting_collaboration_id = ${meeting.id}::uuid
      `);
      return { kind: 'ready' as const, meeting, attendees, resources };
    });

    if (prepared.kind === 'missing') return reply.code(404).send({ error: 'meeting_not_found' });
    if (prepared.kind === 'forbidden') return reply.code(403).send({ error: 'meeting_update_denied' });
    if (prepared.kind === 'not-scheduled') return reply.code(409).send({ error: 'meeting_not_schedulable', lifecycleStatus: prepared.meeting.lifecycle_status });
    if (prepared.kind === 'version-conflict') return reply.code(409).send({ error: 'version_conflict' });

    const timeChanged = prepared.meeting.start_at.getTime() !== body.data.startAt.getTime()
      || prepared.meeting.end_at.getTime() !== body.data.endAt.getTime();
    const mustSync = Boolean(prepared.meeting.graph_event_id) || body.data.requestM365Sync;
    const syncAvailable = config.M365_CALENDAR_SYNC_ENABLED && config.MEETING_CALENDAR_WORKER_AVAILABLE;

    if (mustSync && !syncAvailable) {
      return reply.code(409).send({ error: 'm365_calendar_sync_unavailable' });
    }
    if (mustSync && !config.M365_AVAILABILITY_ENABLED) {
      return reply.code(409).send({ error: 'm365_availability_disabled' });
    }
    if (
      mustSync
      && prepared.meeting.graph_event_id
      && timeChanged
      && intervalsOverlap(prepared.meeting.start_at, prepared.meeting.end_at, body.data.startAt, body.data.endAt)
    ) {
      return reply.code(409).send({
        error: 'reschedule_partial_overlap_requires_nonoverlap_v2',
        message: 'Choose a new interval that does not overlap the current Outlook event so availability can be validated without treating the meeting itself as a conflict.',
      });
    }

    if (mustSync && timeChanged) {
      const schedules = [...new Set([
        actor.email.toLowerCase(),
        ...prepared.attendees.map((item) => item.email.toLowerCase()),
        ...prepared.resources.map((item) => item.email.toLowerCase()),
      ])];
      try {
        const results = await graph.getSchedule({
          organizerGraphUser: prepared.meeting.organizer_graph_user,
          schedules,
          startAt: body.data.startAt,
          endAt: body.data.endAt,
          intervalMinutes: 30,
        });
        const byEmail = new Map(results.map((item) => [item.scheduleId.toLowerCase(), item]));
        const conflicts = schedules.filter((email) => {
          const schedule = byEmail.get(email);
          return !schedule || !scheduleFree(schedule.availabilityView);
        });
        if (conflicts.length) return reply.code(409).send({ error: 'meeting_slot_conflict', conflictingCalendars: conflicts.length });
      } catch (error) {
        if (error instanceof MicrosoftGraphAvailabilityConfigurationError) return reply.code(409).send({ error: 'm365_availability_disabled' });
        if (error instanceof MicrosoftGraphAvailabilityError) return reply.code(error.retryable ? 503 : 502).send({ error: 'm365_availability_failed' });
        throw error;
      }
    }

    return withTenant(actor.tenantId, async (tx) => {
      const updated = await tx.nexusObject.updateMany({
        where: {
          id: prepared.meeting.meeting_object_id,
          tenantId: actor.tenantId,
          version: body.data.version,
          deletedAt: null,
        },
        data: {
          startDate: body.data.startAt,
          dueDate: body.data.endAt,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) return reply.code(409).send({ error: 'version_conflict' });

      const nextSyncStatus = mustSync ? 'PENDING' : 'LOCAL_ONLY';
      await tx.$executeRaw(Prisma.sql`
        UPDATE meeting_collaboration_v1
        SET start_at = ${body.data.startAt}, end_at = ${body.data.endAt}, timezone = ${body.data.timezone},
            location = ${body.data.location === undefined ? prepared.meeting.location : body.data.location},
            sync_status = ${nextSyncStatus}::"MeetingM365SyncStatusV1", sync_error = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${prepared.meeting.id}::uuid
      `);
      if (mustSync) {
        await tx.domainEvent.create({
          data: {
            tenantId: actor.tenantId,
            aggregateId: prepared.meeting.meeting_object_id,
            eventType: 'bridata.meeting.m365.sync.requested',
            payload: { collaborationId: prepared.meeting.id, meetingObjectId: prepared.meeting.meeting_object_id, reason: 'rescheduled_v2' },
          },
        });
      }
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          userId: actor.userId,
          action: 'MEETING_RESCHEDULED_V2',
          resource: 'NEXUS_OBJECT',
          resourceId: prepared.meeting.meeting_object_id,
          correlationId: request.id,
          ipAddress: request.ip,
          details: {
            previousStartAt: prepared.meeting.start_at.toISOString(), previousEndAt: prepared.meeting.end_at.toISOString(),
            startAt: body.data.startAt.toISOString(), endAt: body.data.endAt.toISOString(), syncRequested: mustSync,
          },
        },
      });
      return { meetingObjectId: prepared.meeting.meeting_object_id, version: body.data.version + 1, syncStatus: nextSyncStatus };
    });
  });

  app.post('/api/v1/meetings-v2/:meetingObjectId/cancel', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = cancelSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      const meeting = await getMeeting(tx, actor.tenantId, params.data.meetingObjectId);
      if (!meeting) return reply.code(404).send({ error: 'meeting_not_found' });
      const canManage = await canManageWorkspace(tx, actor, meeting.workspace_id);
      if (!canManage && meeting.organizer_user_id !== actor.userId) return reply.code(403).send({ error: 'meeting_cancel_denied' });
      if (meeting.lifecycle_status === 'CANCELLED') return { lifecycleStatus: 'CANCELLED', syncStatus: meeting.sync_status, alreadyCancelled: true };
      if (meeting.lifecycle_status === 'CANCEL_PENDING') return { lifecycleStatus: 'CANCEL_PENDING', syncStatus: meeting.sync_status, alreadyCancelled: false };
      if (meeting.version !== body.data.version) return reply.code(409).send({ error: 'version_conflict' });

      const updated = await tx.nexusObject.updateMany({
        where: { id: meeting.meeting_object_id, tenantId: actor.tenantId, version: body.data.version, deletedAt: null },
        data: { status: 'CANCELLED', version: { increment: 1 } },
      });
      if (updated.count !== 1) return reply.code(409).send({ error: 'version_conflict' });

      await tx.$executeRaw(Prisma.sql`
        DELETE FROM meeting_resource_bookings_v1
        WHERE tenant_id = ${actor.tenantId}::uuid AND meeting_collaboration_id = ${meeting.id}::uuid
      `);

      const needsExternalCancel = Boolean(meeting.graph_event_id);
      const lifecycleStatus = needsExternalCancel ? 'CANCEL_PENDING' : 'CANCELLED';
      const syncStatus = needsExternalCancel ? 'PENDING' : 'LOCAL_ONLY';
      await tx.$executeRaw(Prisma.sql`
        UPDATE meeting_collaboration_v1
        SET lifecycle_status = ${lifecycleStatus}::"MeetingLifecycleStatusV2",
            sync_status = ${syncStatus}::"MeetingM365SyncStatusV1",
            cancelled_at = ${needsExternalCancel ? null : new Date()},
            cancelled_by = ${actor.userId}::uuid,
            cancellation_comment = ${body.data.comment ?? null},
            sync_error = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${meeting.id}::uuid
      `);
      if (needsExternalCancel) {
        await tx.domainEvent.create({
          data: {
            tenantId: actor.tenantId,
            aggregateId: meeting.meeting_object_id,
            eventType: 'bridata.meeting.m365.cancel.requested',
            payload: { collaborationId: meeting.id, meetingObjectId: meeting.meeting_object_id },
          },
        });
      }
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          userId: actor.userId,
          action: 'MEETING_CANCELLED_V2',
          resource: 'NEXUS_OBJECT',
          resourceId: meeting.meeting_object_id,
          correlationId: request.id,
          ipAddress: request.ip,
          details: { collaborationId: meeting.id, lifecycleStatus, resourcesReleased: true, externalCancellationRequested: needsExternalCancel },
        },
      });
      return { meetingObjectId: meeting.meeting_object_id, version: body.data.version + 1, lifecycleStatus, syncStatus, resourcesReleased: true };
    });
  });

  app.post('/api/v1/meetings-v2/:meetingObjectId/retry-cancel', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      const meeting = await getMeeting(tx, actor.tenantId, params.data.meetingObjectId);
      if (!meeting) return reply.code(404).send({ error: 'meeting_not_found' });
      const canManage = await canManageWorkspace(tx, actor, meeting.workspace_id);
      if (!canManage && meeting.organizer_user_id !== actor.userId) return reply.code(403).send({ error: 'meeting_cancel_denied' });
      if (meeting.lifecycle_status === 'CANCELLED') return { lifecycleStatus: 'CANCELLED', syncStatus: meeting.sync_status };
      if (!meeting.graph_event_id) return reply.code(409).send({ error: 'meeting_has_no_m365_event' });

      await tx.$executeRaw(Prisma.sql`
        UPDATE meeting_collaboration_v1
        SET lifecycle_status = 'CANCEL_PENDING'::"MeetingLifecycleStatusV2",
            sync_status = 'PENDING'::"MeetingM365SyncStatusV1", sync_error = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${meeting.id}::uuid
      `);
      await tx.domainEvent.create({
        data: {
          tenantId: actor.tenantId,
          aggregateId: meeting.meeting_object_id,
          eventType: 'bridata.meeting.m365.cancel.requested',
          payload: { collaborationId: meeting.id, meetingObjectId: meeting.meeting_object_id, reason: 'retry_cancel_v2' },
        },
      });
      return { lifecycleStatus: 'CANCEL_PENDING', syncStatus: 'PENDING' };
    });
  });
}
