import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canAccessWorkspace } from '../authorization.js';
import { config } from '../config.js';
import { findCommonFreeSlotsV1 } from '../domain/meeting-availability-v1.js';
import {
  MicrosoftGraphAvailabilityClient,
  MicrosoftGraphAvailabilityConfigurationError,
  MicrosoftGraphAvailabilityError,
} from '../microsoft-graph-availability-client.js';
import { withTenant } from '../tenant-transaction.js';

const uuid = z.string().uuid();
const availabilitySchema = z.object({
  workspaceId: uuid,
  attendeeUserIds: z.array(uuid).max(50).default([]),
  resourceIds: z.array(uuid).max(20).default([]),
  includeOrganizer: z.boolean().default(true),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  intervalMinutes: z.number().int().min(5).max(60).default(30),
  durationMinutes: z.number().int().min(15).max(480).default(60),
}).superRefine((value, ctx) => {
  if (value.endAt <= value.startAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endAt'], message: 'endAt must be after startAt' });
  }
  if (value.endAt.getTime() - value.startAt.getTime() > 7 * 24 * 60 * 60 * 1000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endAt'], message: 'availability range cannot exceed 7 days' });
  }
  if (value.durationMinutes % value.intervalMinutes !== 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['durationMinutes'], message: 'durationMinutes must be divisible by intervalMinutes' });
  }
});

type ResourceRow = {
  id: string;
  email: string;
  name: string;
  resource_type: 'ROOM' | 'EQUIPMENT';
  location: string | null;
  capacity: number | null;
};

export async function meetingResourceAvailabilityV1Routes(app: FastifyInstance): Promise<void> {
  const graph = new MicrosoftGraphAvailabilityClient();
  app.addHook('onClose', async () => graph.close());

  app.post('/api/v1/meetings-v1/availability-v2', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const body = availabilitySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'validation_error', details: body.error.flatten() });
    if (!config.M365_AVAILABILITY_ENABLED) {
      return reply.code(409).send({
        error: 'm365_availability_disabled',
        message: 'Microsoft 365 availability lookup is not enabled for this environment.',
      });
    }

    const actor = request.actor!;
    const resolved = await withTenant(actor.tenantId, async (tx) => {
      if (!(await canAccessWorkspace(tx, actor, body.data.workspaceId))) {
        return { kind: 'forbidden' as const };
      }

      const userIds = [...new Set(body.data.attendeeUserIds)];
      const resourceIds = [...new Set(body.data.resourceIds)];
      const [members, resources] = await Promise.all([
        userIds.length
          ? tx.workspaceMember.findMany({
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
          : [],
        resourceIds.length
          ? tx.$queryRaw<ResourceRow[]>(Prisma.sql`
              SELECT id, email, name, resource_type, location, capacity
              FROM meeting_resources_v1
              WHERE tenant_id = ${actor.tenantId}::uuid
                AND workspace_id = ${body.data.workspaceId}::uuid
                AND id = ANY(${resourceIds}::uuid[])
                AND is_active = true
            `)
          : [],
      ]);

      if (members.length !== userIds.length) return { kind: 'invalid_member' as const };
      if (resources.length !== resourceIds.length) return { kind: 'invalid_resource' as const };

      const people = members.map((member) => ({
        key: `user:${member.userId}`,
        kind: 'PERSON' as const,
        id: member.userId,
        fullName: member.user.fullName,
        email: member.user.email.toLowerCase(),
        isOrganizer: member.userId === actor.userId,
        location: null,
        capacity: null,
      }));
      if (body.data.includeOrganizer && !people.some((participant) => participant.id === actor.userId)) {
        people.unshift({
          key: `user:${actor.userId}`,
          kind: 'PERSON',
          id: actor.userId,
          fullName: actor.name,
          email: actor.email.toLowerCase(),
          isOrganizer: true,
          location: null,
          capacity: null,
        });
      }

      const resourceParticipants = resources.map((resource) => ({
        key: `resource:${resource.id}`,
        kind: resource.resource_type as 'ROOM' | 'EQUIPMENT',
        id: resource.id,
        fullName: resource.name,
        email: resource.email.toLowerCase(),
        isOrganizer: false,
        location: resource.location,
        capacity: resource.capacity,
      }));

      return { kind: 'ready' as const, participants: [...people, ...resourceParticipants] };
    });

    if (resolved.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
    if (resolved.kind === 'invalid_member') return reply.code(409).send({ error: 'attendee_not_workspace_member' });
    if (resolved.kind === 'invalid_resource') return reply.code(409).send({ error: 'meeting_resource_invalid_or_inactive' });
    if (!resolved.participants.length) {
      return {
        source: 'MICROSOFT_GRAPH',
        intervalMinutes: body.data.intervalMinutes,
        durationMinutes: body.data.durationMinutes,
        range: { start: body.data.startAt.toISOString(), end: body.data.endAt.toISOString() },
        participants: [],
        suggestions: [],
      };
    }

    try {
      const schedules = await graph.getSchedule({
        organizerGraphUser: actor.email,
        schedules: resolved.participants.map((participant) => participant.email),
        startAt: body.data.startAt,
        endAt: body.data.endAt,
        intervalMinutes: body.data.intervalMinutes,
      });
      const byEmail = new Map(schedules.map((schedule) => [schedule.scheduleId.toLowerCase(), schedule]));
      const participants = resolved.participants.map((participant) => {
        const schedule = byEmail.get(participant.email);
        return {
          ...participant,
          availabilityView: schedule?.availabilityView ?? '',
          conflicts: schedule?.conflicts ?? [],
          resolved: Boolean(schedule),
        };
      });
      const suggestions = findCommonFreeSlotsV1({
        startAt: body.data.startAt,
        endAt: body.data.endAt,
        intervalMinutes: body.data.intervalMinutes,
        durationMinutes: body.data.durationMinutes,
        availabilityViews: participants.map((participant) => participant.availabilityView),
      });
      return {
        source: 'MICROSOFT_GRAPH',
        intervalMinutes: body.data.intervalMinutes,
        durationMinutes: body.data.durationMinutes,
        range: { start: body.data.startAt.toISOString(), end: body.data.endAt.toISOString() },
        participants,
        suggestions,
      };
    } catch (error) {
      if (error instanceof MicrosoftGraphAvailabilityConfigurationError) {
        return reply.code(409).send({ error: 'm365_availability_disabled', message: error.message });
      }
      if (error instanceof MicrosoftGraphAvailabilityError) {
        request.log.warn({ err: error }, 'Microsoft Graph combined availability lookup failed');
        return reply.code(error.retryable ? 503 : 502).send({
          error: 'm365_availability_failed',
          message: 'Microsoft 365 availability could not be retrieved.',
        });
      }
      throw error;
    }
  });
}
