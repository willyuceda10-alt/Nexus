import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canAccessWorkspace } from '../authorization.js';
import { config } from '../config.js';
import {
  MicrosoftGraphAvailabilityClient,
  MicrosoftGraphAvailabilityConfigurationError,
  MicrosoftGraphAvailabilityError,
} from '../microsoft-graph-availability-client.js';
import { withTenant } from '../tenant-transaction.js';

const uuid = z.string().uuid();
const attendeeType = z.enum(['REQUIRED', 'OPTIONAL']);
const externalAttendeeSchema = z.object({
  email: z.string().trim().email().max(320),
  displayName: z.string().trim().min(1).max(255),
  attendeeType: attendeeType.default('REQUIRED'),
});

const scheduleSchema = z.object({
  workspaceId: uuid,
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
  resourceIds: z.array(uuid).max(20).default([]),
  requestM365Sync: z.boolean().default(true),
  validateAvailability: z.boolean().default(true),
}).superRefine((value, ctx) => {
  if (value.endAt <= value.startAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endAt'], message: 'endAt must be after startAt' });
  }
  if (value.endAt.getTime() - value.startAt.getTime() > 8 * 60 * 60 * 1000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endAt'], message: 'meeting duration cannot exceed 8 hours' });
  }
});

type ResolvedPerson = { userId: string; email: string; displayName: string };
type ResolvedResource = {
  id: string;
  resourceType: 'ROOM' | 'EQUIPMENT';
  name: string;
  email: string;
  capacity: number | null;
  location: string | null;
};

function dedupeEmails(values: Array<{ email: string; displayName: string; attendeeType: 'REQUIRED' | 'OPTIONAL'; userId: string | null }>) {
  const map = new Map<string, (typeof values)[number]>();
  for (const value of values) map.set(value.email.trim().toLowerCase(), value);
  return [...map.values()];
}

function slotIsFree(availabilityView: string): boolean {
  return availabilityView.length > 0 && [...availabilityView].every((value) => value === '0');
}

export async function meetingSchedulingV2Routes(app: FastifyInstance): Promise<void> {
  const graph = new MicrosoftGraphAvailabilityClient();
  app.addHook('onClose', async () => graph.close());

  app.post('/api/v1/meetings-v2/schedule', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const body = scheduleSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'validation_error', details: body.error.flatten() });

    const actor = request.actor!;
    const resolved = await withTenant(actor.tenantId, async (tx) => {
      if (!(await canAccessWorkspace(tx, actor, body.data.workspaceId))) {
        return { kind: 'forbidden' as const };
      }

      const definition = await tx.objectDefinition.findFirst({
        where: { tenantId: actor.tenantId, key: 'MEETING' },
        select: { id: true },
      });
      if (!definition) return { kind: 'definition-missing' as const };

      if (body.data.projectId) {
        const project = await tx.nexusObject.findFirst({
          where: {
            id: body.data.projectId,
            tenantId: actor.tenantId,
            workspaceId: body.data.workspaceId,
            objectTypeKey: 'PROJECT',
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!project) return { kind: 'project-invalid' as const };
      }

      const userIds = [...new Set(body.data.attendeeUserIds)];
      const members = userIds.length
        ? await tx.workspaceMember.findMany({
            where: {
              tenantId: actor.tenantId,
              workspaceId: body.data.workspaceId,
              userId: { in: userIds },
              user: {
                isActive: true,
                tenantMemberships: { some: { tenantId: actor.tenantId, status: 'ACTIVE' } },
              },
            },
            select: { userId: true, user: { select: { email: true, fullName: true } } },
          })
        : [];
      if (members.length !== userIds.length) return { kind: 'member-invalid' as const };

      const resourceIds = [...new Set(body.data.resourceIds)];
      const resources = resourceIds.length
        ? await tx.$queryRaw<Array<{ id: string; resource_type: 'ROOM' | 'EQUIPMENT'; name: string; email: string; capacity: number | null; location: string | null }>>(Prisma.sql`
            SELECT id, resource_type, name, email, capacity, location
            FROM meeting_resources_v1
            WHERE tenant_id = ${actor.tenantId}::uuid
              AND workspace_id = ${body.data.workspaceId}::uuid
              AND id = ANY(${resourceIds}::uuid[])
              AND is_active = true
          `)
        : [];
      if (resources.length !== resourceIds.length) return { kind: 'resource-invalid' as const };
      if (resources.filter((resource) => resource.resource_type === 'ROOM').length > 1) {
        return { kind: 'multiple-rooms' as const };
      }

      const people: ResolvedPerson[] = members.map((member) => ({
        userId: member.userId,
        email: member.user.email,
        displayName: member.user.fullName,
      }));
      const mappedResources: ResolvedResource[] = resources.map((resource) => ({
        id: resource.id,
        resourceType: resource.resource_type,
        name: resource.name,
        email: resource.email,
        capacity: resource.capacity,
        location: resource.location,
      }));
      return { kind: 'ready' as const, definitionId: definition.id, people, resources: mappedResources };
    });

    if (resolved.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
    if (resolved.kind === 'definition-missing') return reply.code(409).send({ error: 'meeting_object_definition_missing' });
    if (resolved.kind === 'project-invalid') return reply.code(409).send({ error: 'project_scope_invalid' });
    if (resolved.kind === 'member-invalid') return reply.code(409).send({ error: 'attendee_not_workspace_member' });
    if (resolved.kind === 'resource-invalid') return reply.code(409).send({ error: 'meeting_resource_invalid_or_inactive' });
    if (resolved.kind === 'multiple-rooms') return reply.code(409).send({ error: 'only_one_room_supported_v2' });

    const attendeeInputs = dedupeEmails([
      ...resolved.people.map((person) => ({ userId: person.userId, email: person.email, displayName: person.displayName, attendeeType: 'REQUIRED' as const })),
      ...body.data.externalAttendees.map((attendee) => ({ userId: null, email: attendee.email, displayName: attendee.displayName, attendeeType: attendee.attendeeType })),
    ]);
    const uniquePeopleEmails = new Set([actor.email.toLowerCase(), ...attendeeInputs.map((attendee) => attendee.email.toLowerCase())]);
    const room = resolved.resources.find((resource) => resource.resourceType === 'ROOM');
    if (room?.capacity != null && room.capacity < uniquePeopleEmails.size) {
      return reply.code(409).send({
        error: 'room_capacity_exceeded',
        room: { id: room.id, name: room.name, capacity: room.capacity },
        peopleCount: uniquePeopleEmails.size,
      });
    }

    if (body.data.validateAvailability) {
      if (!config.M365_AVAILABILITY_ENABLED) {
        return reply.code(409).send({ error: 'm365_availability_disabled', message: 'Availability validation is required but disabled.' });
      }
      const schedules = [...new Set([
        actor.email.toLowerCase(),
        ...resolved.people.map((person) => person.email.toLowerCase()),
        ...resolved.resources.map((resource) => resource.email.toLowerCase()),
      ])];
      try {
        const graphSchedules = await graph.getSchedule({
          organizerGraphUser: actor.email,
          schedules,
          startAt: body.data.startAt,
          endAt: body.data.endAt,
          intervalMinutes: 30,
        });
        const byEmail = new Map(graphSchedules.map((schedule) => [schedule.scheduleId.toLowerCase(), schedule]));
        const conflicts = schedules.filter((email) => {
          const schedule = byEmail.get(email);
          return !schedule || !slotIsFree(schedule.availabilityView);
        });
        if (conflicts.length) {
          return reply.code(409).send({ error: 'meeting_slot_conflict', conflictingCalendars: conflicts.length });
        }
      } catch (error) {
        if (error instanceof MicrosoftGraphAvailabilityConfigurationError) {
          return reply.code(409).send({ error: 'm365_availability_disabled', message: error.message });
        }
        if (error instanceof MicrosoftGraphAvailabilityError) {
          return reply.code(error.retryable ? 503 : 502).send({ error: 'm365_availability_failed' });
        }
        throw error;
      }
    }

    const organizerGraphUser = request.authPrincipal?.provider === 'ENTRA_ID'
      ? request.authPrincipal.subject
      : actor.email;
    const syncAvailable = config.M365_CALENDAR_SYNC_ENABLED && config.MEETING_CALENDAR_WORKER_AVAILABLE;
    const shouldSync = body.data.requestM365Sync && syncAvailable;

    return withTenant(actor.tenantId, async (tx) => {
      const object = await tx.nexusObject.create({
        data: {
          tenantId: actor.tenantId,
          workspaceId: body.data.workspaceId,
          objectDefinitionId: resolved.definitionId,
          objectTypeKey: 'MEETING',
          title: body.data.title,
          description: body.data.description ?? null,
          status: 'PLANNING',
          priority: 'MEDIUM',
          progress: 0,
          ownerId: actor.userId,
          startDate: body.data.startAt,
          dueDate: body.data.endAt,
          metadata: body.data.projectId ? { projectId: body.data.projectId } : Prisma.JsonNull,
        },
      });
      const syncStatus = shouldSync ? 'PENDING' : 'LOCAL_ONLY';
      const collaborations = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO meeting_collaboration_v1
          (tenant_id, workspace_id, meeting_object_id, project_id, organizer_user_id, organizer_graph_user,
           start_at, end_at, timezone, location, is_online, online_provider, sync_status)
        VALUES
          (${actor.tenantId}::uuid, ${body.data.workspaceId}::uuid, ${object.id}::uuid,
           ${body.data.projectId ?? null}::uuid, ${actor.userId}::uuid, ${organizerGraphUser},
           ${body.data.startAt}, ${body.data.endAt}, ${body.data.timezone}, ${body.data.location ?? room?.location ?? null},
           ${body.data.isOnline}, 'TEAMS', ${syncStatus}::"MeetingM365SyncStatusV1")
        RETURNING id
      `);
      const collaborationId = collaborations[0]!.id;

      for (const attendee of attendeeInputs) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO meeting_collaboration_attendees_v1
            (tenant_id, meeting_collaboration_id, user_id, email, display_name, attendee_type)
          VALUES
            (${actor.tenantId}::uuid, ${collaborationId}::uuid, ${attendee.userId ?? null}::uuid,
             ${attendee.email.toLowerCase()}, ${attendee.displayName}, ${attendee.attendeeType})
        `);
      }
      for (const resource of resolved.resources) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO meeting_resource_bookings_v1
            (tenant_id, meeting_collaboration_id, meeting_resource_id, created_by)
          VALUES (${actor.tenantId}::uuid, ${collaborationId}::uuid, ${resource.id}::uuid, ${actor.userId}::uuid)
        `);
      }

      if (shouldSync) {
        await tx.domainEvent.create({
          data: {
            tenantId: actor.tenantId,
            aggregateId: object.id,
            eventType: 'bridata.meeting.m365.sync.requested',
            payload: { collaborationId, meetingObjectId: object.id, reason: 'meeting_scheduling_v2' },
          },
        });
      }
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          userId: actor.userId,
          action: 'MEETING_SCHEDULED_V2',
          resource: 'NEXUS_OBJECT',
          resourceId: object.id,
          correlationId: request.id,
          ipAddress: request.ip,
          details: {
            collaborationId,
            attendeeCount: attendeeInputs.length,
            resourceIds: resolved.resources.map((resource) => resource.id),
            roomId: room?.id ?? null,
            availabilityValidated: body.data.validateAvailability,
            syncRequested: shouldSync,
          },
        },
      });

      return reply.code(201).send({
        collaborationId,
        meetingObjectId: object.id,
        version: object.version,
        syncStatus,
        room: room ? { id: room.id, name: room.name, capacity: room.capacity } : null,
        resources: resolved.resources.map((resource) => ({ id: resource.id, name: resource.name, resourceType: resource.resourceType })),
      });
    });
  });
}
