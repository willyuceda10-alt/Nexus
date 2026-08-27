import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canAccessWorkspace, canManageWorkspace } from '../authorization.js';
import { config } from '../config.js';
import { withTenant } from '../tenant-transaction.js';

const uuid = z.string().uuid();
const attendeeType = z.enum(['REQUIRED', 'OPTIONAL']);
const externalAttendeeSchema = z.object({
  email: z.string().email().max(320),
  displayName: z.string().trim().min(1).max(255),
  attendeeType: attendeeType.default('REQUIRED'),
});

const meetingMutableFieldsSchema = z.object({
  projectId: uuid.nullable().optional(),
  title: z.string().trim().min(1).max(500),
  description: z.string().max(20000).nullable().optional(),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  timezone: z.string().trim().min(1).max(100).default('America/Lima'),
  location: z.string().trim().max(500).nullable().optional(),
  isOnline: z.boolean().default(true),
  attendeeUserIds: z.array(uuid).max(100).default([]),
  externalAttendees: z.array(externalAttendeeSchema).max(50).default([]),
  requestM365Sync: z.boolean().default(true),
});

const createMeetingSchema = meetingMutableFieldsSchema.extend({
  workspaceId: uuid,
}).refine((value) => value.endAt >= value.startAt, {
  message: 'endAt must be >= startAt',
  path: ['endAt'],
});

const updateMeetingSchema = meetingMutableFieldsSchema.extend({
  version: z.number().int().positive(),
}).refine((value) => value.endAt >= value.startAt, {
  message: 'endAt must be >= startAt',
  path: ['endAt'],
});

const listQuerySchema = z.object({
  workspaceId: uuid,
  projectId: uuid.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
}).refine((value) => !value.from || !value.to || value.to >= value.from, {
  message: 'to must be >= from',
});

const meetingParams = z.object({ meetingObjectId: uuid });

type CollaborationRow = {
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
  is_online: boolean;
  online_provider: string;
  sync_status: 'LOCAL_ONLY' | 'PENDING' | 'SYNCED' | 'FAILED';
  graph_event_id: string | null;
  join_url: string | null;
  web_link: string | null;
  last_synced_at: Date | null;
  sync_error: string | null;
};

type AttendeeInput = {
  userId: string | null;
  email: string;
  displayName: string;
  attendeeType: 'REQUIRED' | 'OPTIONAL';
};

async function resolveAttendees(
  tx: Prisma.TransactionClient,
  tenantId: string,
  workspaceId: string,
  userIds: string[],
  external: z.infer<typeof externalAttendeeSchema>[],
): Promise<AttendeeInput[] | null> {
  const uniqueUserIds = [...new Set(userIds)];
  const members = uniqueUserIds.length
    ? await tx.workspaceMember.findMany({
        where: {
          tenantId,
          workspaceId,
          userId: { in: uniqueUserIds },
          user: {
            isActive: true,
            tenantMemberships: { some: { tenantId, status: 'ACTIVE' } },
          },
        },
        select: {
          userId: true,
          user: { select: { email: true, fullName: true } },
        },
      })
    : [];

  if (members.length !== uniqueUserIds.length) return null;

  const combined: AttendeeInput[] = [
    ...members.map((member) => ({
      userId: member.userId,
      email: member.user.email,
      displayName: member.user.fullName,
      attendeeType: 'REQUIRED' as const,
    })),
    ...external.map((attendee) => ({
      userId: null,
      email: attendee.email,
      displayName: attendee.displayName,
      attendeeType: attendee.attendeeType,
    })),
  ];

  const byEmail = new Map<string, AttendeeInput>();
  for (const attendee of combined) {
    byEmail.set(attendee.email.trim().toLowerCase(), attendee);
  }
  return [...byEmail.values()];
}

async function collaborationByMeeting(
  tx: Prisma.TransactionClient,
  tenantId: string,
  meetingObjectId: string,
): Promise<CollaborationRow | null> {
  const rows = await tx.$queryRaw<CollaborationRow[]>(Prisma.sql`
    SELECT id, meeting_object_id, workspace_id, project_id, organizer_user_id, organizer_graph_user,
           start_at, end_at, timezone, location, is_online, online_provider, sync_status,
           graph_event_id, join_url, web_link, last_synced_at, sync_error
    FROM meeting_collaboration_v1
    WHERE tenant_id = ${tenantId}::uuid AND meeting_object_id = ${meetingObjectId}::uuid
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function emitMeetingSyncEvent(
  tx: Prisma.TransactionClient,
  tenantId: string,
  collaborationId: string,
  meetingObjectId: string,
): Promise<void> {
  await tx.domainEvent.create({
    data: {
      tenantId,
      aggregateId: meetingObjectId,
      eventType: 'bridata.meeting.m365.sync.requested',
      payload: { collaborationId, meetingObjectId },
    },
  });
}

export async function meetingsV1Routes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/meetings-v1/capabilities',
    { preHandler: [authenticate, resolveActor] },
    async () => ({
      m365CalendarSyncEnabled: config.M365_CALENDAR_SYNC_ENABLED,
      meetingCalendarWorkerAvailable: config.MEETING_CALENDAR_WORKER_AVAILABLE,
      teamsOnlineMeetingSupported: true,
      canonicalStore: 'BRIDATA',
    }),
  );

  app.get(
    '/api/v1/meetings-v1',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const query = listQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({
          error: 'validation_error',
          details: query.error.flatten(),
        });
      }

      const actor = request.actor!;
      return withTenant(actor.tenantId, async (tx) => {
        if (!(await canAccessWorkspace(tx, actor, query.data.workspaceId))) {
          return reply.code(403).send({ error: 'workspace_access_denied' });
        }

        const rows = await tx.$queryRaw<Array<CollaborationRow & {
          title: string;
          description: string | null;
          status: string;
          version: number;
          organizer_name: string;
        }>>(Prisma.sql`
          SELECT c.*, o.title, o.description, o.status, o.version,
                 organizer.full_name AS organizer_name
          FROM meeting_collaboration_v1 c
          JOIN nexus_objects o ON o.id = c.meeting_object_id AND o.deleted_at IS NULL
          JOIN users organizer ON organizer.id = c.organizer_user_id
          WHERE c.tenant_id = ${actor.tenantId}::uuid
            AND c.workspace_id = ${query.data.workspaceId}::uuid
            AND (${query.data.projectId ?? null}::uuid IS NULL OR c.project_id = ${query.data.projectId ?? null}::uuid)
            AND (${query.data.from ?? null}::timestamptz IS NULL OR c.end_at >= ${query.data.from ?? null}::timestamptz)
            AND (${query.data.to ?? null}::timestamptz IS NULL OR c.start_at <= ${query.data.to ?? null}::timestamptz)
          ORDER BY c.start_at, c.id
          LIMIT ${query.data.limit}
        `);

        const ids = rows.map((row) => row.id);
        const attendees = ids.length
          ? await tx.$queryRaw<Array<{
              meeting_collaboration_id: string;
              user_id: string | null;
              email: string;
              display_name: string;
              attendee_type: string;
            }>>(Prisma.sql`
              SELECT meeting_collaboration_id, user_id, email, display_name, attendee_type
              FROM meeting_collaboration_attendees_v1
              WHERE tenant_id = ${actor.tenantId}::uuid
                AND meeting_collaboration_id = ANY(${ids}::uuid[])
              ORDER BY display_name
            `)
          : [];

        return {
          items: rows.map((row) => ({
            id: row.id,
            meetingObjectId: row.meeting_object_id,
            workspaceId: row.workspace_id,
            projectId: row.project_id,
            title: row.title,
            description: row.description,
            status: row.status,
            version: row.version,
            organizer: { id: row.organizer_user_id, name: row.organizer_name },
            startAt: row.start_at.toISOString(),
            endAt: row.end_at.toISOString(),
            timezone: row.timezone,
            location: row.location,
            isOnline: row.is_online,
            onlineProvider: row.online_provider,
            syncStatus: row.sync_status,
            graphEventId: row.graph_event_id,
            joinUrl: row.join_url,
            webLink: row.web_link,
            lastSyncedAt: row.last_synced_at?.toISOString() ?? null,
            syncError: row.sync_error,
            attendees: attendees
              .filter((attendee) => attendee.meeting_collaboration_id === row.id)
              .map((attendee) => ({
                userId: attendee.user_id,
                email: attendee.email,
                displayName: attendee.display_name,
                attendeeType: attendee.attendee_type,
              })),
          })),
        };
      });
    },
  );

  app.post(
    '/api/v1/meetings-v1',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const body = createMeetingSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({
          error: 'validation_error',
          details: body.error.flatten(),
        });
      }

      const actor = request.actor!;
      return withTenant(actor.tenantId, async (tx) => {
        if (!(await canAccessWorkspace(tx, actor, body.data.workspaceId))) {
          return reply.code(403).send({ error: 'workspace_access_denied' });
        }

        const [definition, organizer, project] = await Promise.all([
          tx.objectDefinition.findFirst({
            where: { tenantId: actor.tenantId, key: 'MEETING' },
            select: { id: true },
          }),
          tx.user.findFirst({
            where: { id: actor.userId, isActive: true },
            select: { id: true, email: true },
          }),
          body.data.projectId
            ? tx.nexusObject.findFirst({
                where: {
                  id: body.data.projectId,
                  tenantId: actor.tenantId,
                  workspaceId: body.data.workspaceId,
                  objectTypeKey: 'PROJECT',
                  deletedAt: null,
                },
                select: { id: true },
              })
            : null,
        ]);

        if (!definition) {
          return reply.code(409).send({ error: 'meeting_object_definition_missing' });
        }
        if (!organizer) {
          return reply.code(409).send({ error: 'organizer_not_available' });
        }
        if (body.data.projectId && !project) {
          return reply.code(409).send({ error: 'project_scope_invalid' });
        }

        const attendees = await resolveAttendees(
          tx,
          actor.tenantId,
          body.data.workspaceId,
          body.data.attendeeUserIds,
          body.data.externalAttendees,
        );
        if (!attendees) {
          return reply.code(409).send({ error: 'attendee_not_workspace_member' });
        }

        const organizerGraphUser = request.authPrincipal?.provider === 'ENTRA_ID'
          ? request.authPrincipal.subject
          : organizer.email;

        const object = await tx.nexusObject.create({
          data: {
            tenantId: actor.tenantId,
            workspaceId: body.data.workspaceId,
            objectDefinitionId: definition.id,
            objectTypeKey: 'MEETING',
            title: body.data.title,
            description: body.data.description ?? null,
            status: 'PLANNING',
            priority: 'MEDIUM',
            progress: 0,
            ownerId: actor.userId,
            startDate: body.data.startAt,
            dueDate: body.data.endAt,
            metadata: body.data.projectId
              ? { projectId: body.data.projectId }
              : Prisma.JsonNull,
          },
        });

        const syncStatus = body.data.requestM365Sync ? 'PENDING' : 'LOCAL_ONLY';
        const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          INSERT INTO meeting_collaboration_v1
            (tenant_id, workspace_id, meeting_object_id, project_id,
             organizer_user_id, organizer_graph_user, start_at, end_at,
             timezone, location, is_online, online_provider, sync_status)
          VALUES
            (${actor.tenantId}::uuid, ${body.data.workspaceId}::uuid, ${object.id}::uuid,
             ${body.data.projectId ?? null}::uuid, ${actor.userId}::uuid, ${organizerGraphUser},
             ${body.data.startAt}, ${body.data.endAt}, ${body.data.timezone},
             ${body.data.location ?? null}, ${body.data.isOnline}, 'TEAMS',
             ${syncStatus}::"MeetingM365SyncStatusV1")
          RETURNING id
        `);

        const collaborationId = rows[0]!.id;
        for (const attendee of attendees) {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO meeting_collaboration_attendees_v1
              (tenant_id, meeting_collaboration_id, user_id, email, display_name, attendee_type)
            VALUES
              (${actor.tenantId}::uuid, ${collaborationId}::uuid,
               ${attendee.userId ?? null}::uuid, ${attendee.email},
               ${attendee.displayName}, ${attendee.attendeeType})
          `);
        }

        await Promise.all([
          body.data.requestM365Sync
            ? emitMeetingSyncEvent(tx, actor.tenantId, collaborationId, object.id)
            : Promise.resolve(),
          tx.auditLog.create({
            data: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              action: 'MEETING_CREATED',
              resource: 'NEXUS_OBJECT',
              resourceId: object.id,
              correlationId: request.id,
              ipAddress: request.ip,
              details: {
                collaborationId,
                projectId: body.data.projectId ?? null,
                isOnline: body.data.isOnline,
                attendeeCount: attendees.length,
                requestM365Sync: body.data.requestM365Sync,
              },
            },
          }),
        ]);

        return reply.code(201).send({
          collaborationId,
          meetingObjectId: object.id,
          version: object.version,
          syncStatus,
        });
      });
    },
  );

  app.put(
    '/api/v1/meetings-v1/:meetingObjectId',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = meetingParams.safeParse(request.params);
      const body = updateMeetingSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({
          error: 'validation_error',
          details: {
            ...(params.success ? {} : { params: params.error.flatten() }),
            ...(body.success ? {} : { body: body.error.flatten() }),
          },
        });
      }

      const actor = request.actor!;
      return withTenant(actor.tenantId, async (tx) => {
        const collaboration = await collaborationByMeeting(
          tx,
          actor.tenantId,
          params.data.meetingObjectId,
        );
        if (!collaboration) {
          return reply.code(404).send({ error: 'meeting_not_found' });
        }

        const canManage = await canManageWorkspace(tx, actor, collaboration.workspace_id);
        if (!canManage && collaboration.organizer_user_id !== actor.userId) {
          return reply.code(403).send({ error: 'meeting_update_denied' });
        }

        if (collaboration.graph_event_id && collaboration.is_online && !body.data.isOnline) {
          return reply.code(409).send({
            error: 'online_meeting_cannot_be_downgraded',
            message: 'A Teams meeting already synchronized with Microsoft 365 cannot be converted to offline in place.',
          });
        }

        if (body.data.projectId) {
          const project = await tx.nexusObject.findFirst({
            where: {
              id: body.data.projectId,
              tenantId: actor.tenantId,
              workspaceId: collaboration.workspace_id,
              objectTypeKey: 'PROJECT',
              deletedAt: null,
            },
            select: { id: true },
          });
          if (!project) {
            return reply.code(409).send({ error: 'project_scope_invalid' });
          }
        }

        const attendees = await resolveAttendees(
          tx,
          actor.tenantId,
          collaboration.workspace_id,
          body.data.attendeeUserIds,
          body.data.externalAttendees,
        );
        if (!attendees) {
          return reply.code(409).send({ error: 'attendee_not_workspace_member' });
        }

        const updated = await tx.nexusObject.updateMany({
          where: {
            id: collaboration.meeting_object_id,
            tenantId: actor.tenantId,
            version: body.data.version,
            deletedAt: null,
          },
          data: {
            title: body.data.title,
            description: body.data.description ?? null,
            startDate: body.data.startAt,
            dueDate: body.data.endAt,
            metadata: body.data.projectId
              ? { projectId: body.data.projectId }
              : Prisma.JsonNull,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          return reply.code(409).send({ error: 'version_conflict' });
        }

        const shouldSync = Boolean(collaboration.graph_event_id) || body.data.requestM365Sync;
        const nextStatus: CollaborationRow['sync_status'] = shouldSync
          ? 'PENDING'
          : collaboration.sync_status;

        await tx.$executeRaw(Prisma.sql`
          UPDATE meeting_collaboration_v1
          SET project_id = ${body.data.projectId ?? null}::uuid,
              start_at = ${body.data.startAt},
              end_at = ${body.data.endAt},
              timezone = ${body.data.timezone},
              location = ${body.data.location ?? null},
              is_online = ${body.data.isOnline},
              sync_status = ${nextStatus}::"MeetingM365SyncStatusV1",
              sync_error = NULL,
              updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ${actor.tenantId}::uuid
            AND id = ${collaboration.id}::uuid
        `);

        await tx.$executeRaw(Prisma.sql`
          DELETE FROM meeting_collaboration_attendees_v1
          WHERE tenant_id = ${actor.tenantId}::uuid
            AND meeting_collaboration_id = ${collaboration.id}::uuid
        `);

        for (const attendee of attendees) {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO meeting_collaboration_attendees_v1
              (tenant_id, meeting_collaboration_id, user_id, email, display_name, attendee_type)
            VALUES
              (${actor.tenantId}::uuid, ${collaboration.id}::uuid,
               ${attendee.userId ?? null}::uuid, ${attendee.email},
               ${attendee.displayName}, ${attendee.attendeeType})
          `);
        }

        if (shouldSync) {
          await emitMeetingSyncEvent(
            tx,
            actor.tenantId,
            collaboration.id,
            collaboration.meeting_object_id,
          );
        }

        await tx.auditLog.create({
          data: {
            tenantId: actor.tenantId,
            userId: actor.userId,
            action: 'MEETING_UPDATED',
            resource: 'NEXUS_OBJECT',
            resourceId: collaboration.meeting_object_id,
            correlationId: request.id,
            ipAddress: request.ip,
            details: {
              collaborationId: collaboration.id,
              projectId: body.data.projectId ?? null,
              isOnline: body.data.isOnline,
              attendeeCount: attendees.length,
              syncRequested: shouldSync,
            },
          },
        });

        return {
          meetingObjectId: collaboration.meeting_object_id,
          version: body.data.version + 1,
          syncStatus: nextStatus,
        };
      });
    },
  );

  app.post(
    '/api/v1/meetings-v1/:meetingObjectId/retry-sync',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = meetingParams.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'validation_error' });
      }

      const actor = request.actor!;
      return withTenant(actor.tenantId, async (tx) => {
        const collaboration = await collaborationByMeeting(
          tx,
          actor.tenantId,
          params.data.meetingObjectId,
        );
        if (!collaboration) {
          return reply.code(404).send({ error: 'meeting_not_found' });
        }

        const canManage = await canManageWorkspace(tx, actor, collaboration.workspace_id);
        if (!canManage && collaboration.organizer_user_id !== actor.userId) {
          return reply.code(403).send({ error: 'meeting_sync_denied' });
        }

        await tx.$executeRaw(Prisma.sql`
          UPDATE meeting_collaboration_v1
          SET sync_status = 'PENDING'::"MeetingM365SyncStatusV1",
              sync_error = NULL,
              updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ${actor.tenantId}::uuid
            AND id = ${collaboration.id}::uuid
        `);

        await emitMeetingSyncEvent(
          tx,
          actor.tenantId,
          collaboration.id,
          collaboration.meeting_object_id,
        );

        await tx.auditLog.create({
          data: {
            tenantId: actor.tenantId,
            userId: actor.userId,
            action: 'MEETING_M365_SYNC_RETRIED',
            resource: 'NEXUS_OBJECT',
            resourceId: collaboration.meeting_object_id,
            correlationId: request.id,
            ipAddress: request.ip,
            details: { collaborationId: collaboration.id },
          },
        });

        return { syncStatus: 'PENDING' };
      });
    },
  );
}
