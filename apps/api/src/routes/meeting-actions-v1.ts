import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canAccessWorkspace } from '../authorization.js';
import { withTenant } from '../tenant-transaction.js';

const paramsSchema = z.object({ meetingObjectId: z.string().uuid() });
const bodySchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().trim().max(20000).nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
});

type MeetingRow = {
  meeting_object_id: string;
  workspace_id: string;
  project_id: string | null;
  title: string;
};

export async function meetingActionsV1Routes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/v1/meetings-v1/:meetingObjectId/derive-task',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      const body = bodySchema.safeParse(request.body ?? {});
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
        const meetings = await tx.$queryRaw<MeetingRow[]>(Prisma.sql`
          SELECT c.meeting_object_id, c.workspace_id, c.project_id, o.title
          FROM meeting_collaboration_v1 c
          JOIN nexus_objects o
            ON o.id = c.meeting_object_id
           AND o.deleted_at IS NULL
          WHERE c.tenant_id = ${actor.tenantId}::uuid
            AND c.meeting_object_id = ${params.data.meetingObjectId}::uuid
          LIMIT 1
        `);
        const meeting = meetings[0];
        if (!meeting) return reply.code(404).send({ error: 'meeting_not_found' });

        if (!(await canAccessWorkspace(tx, actor, meeting.workspace_id))) {
          return reply.code(403).send({ error: 'workspace_access_denied' });
        }

        if (body.data.assigneeId) {
          const assignee = await tx.workspaceMember.findFirst({
            where: {
              tenantId: actor.tenantId,
              workspaceId: meeting.workspace_id,
              userId: body.data.assigneeId,
              user: {
                isActive: true,
                tenantMemberships: {
                  some: { tenantId: actor.tenantId, status: 'ACTIVE' },
                },
              },
            },
            select: { userId: true },
          });
          if (!assignee) {
            return reply.code(409).send({ error: 'assignee_not_workspace_member' });
          }
        }

        const taskDefinition = await tx.objectDefinition.findFirst({
          where: { tenantId: actor.tenantId, key: 'TASK' },
          select: { id: true },
        });
        if (!taskDefinition) {
          return reply.code(409).send({ error: 'task_object_definition_missing' });
        }

        const title = body.data.title?.trim() || `[Acción] ${meeting.title}`;
        const description = body.data.description === undefined
          ? `Tarea derivada de la reunión ${meeting.title}`
          : body.data.description;

        const task = await tx.nexusObject.create({
          data: {
            tenantId: actor.tenantId,
            workspaceId: meeting.workspace_id,
            objectDefinitionId: taskDefinition.id,
            objectTypeKey: 'TASK',
            title,
            description,
            status: 'IN_PROGRESS',
            priority: 'HIGH',
            progress: 0,
            ownerId: actor.userId,
            ...(body.data.assigneeId ? { assigneeId: body.data.assigneeId } : {}),
            ...(body.data.dueDate ? { dueDate: body.data.dueDate } : {}),
            metadata: meeting.project_id
              ? { projectId: meeting.project_id, sourceMeetingId: meeting.meeting_object_id }
              : { sourceMeetingId: meeting.meeting_object_id },
          },
        });

        const relation = await tx.objectRelation.create({
          data: {
            tenantId: actor.tenantId,
            sourceObjectId: meeting.meeting_object_id,
            targetObjectId: task.id,
            relationType: 'DERIVED_FROM',
            metadata: {
              source: 'MEETING_ACTION_V1',
              projectId: meeting.project_id,
            },
          },
        });

        await Promise.all([
          tx.domainEvent.create({
            data: {
              tenantId: actor.tenantId,
              aggregateId: task.id,
              eventType: 'bridata.meeting.task.derived',
              payload: {
                meetingObjectId: meeting.meeting_object_id,
                taskObjectId: task.id,
                relationId: relation.id,
                projectId: meeting.project_id,
                actorId: actor.userId,
              },
            },
          }),
          tx.auditLog.create({
            data: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              action: 'MEETING_TASK_DERIVED',
              resource: 'NEXUS_OBJECT',
              resourceId: task.id,
              correlationId: request.id,
              ipAddress: request.ip,
              details: {
                meetingObjectId: meeting.meeting_object_id,
                relationId: relation.id,
                projectId: meeting.project_id,
              },
            },
          }),
        ]);

        return reply.code(201).send({
          taskObjectId: task.id,
          relationId: relation.id,
          version: task.version,
        });
      });
    },
  );
}
