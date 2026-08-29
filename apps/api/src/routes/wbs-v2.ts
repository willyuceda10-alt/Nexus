import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canAccessWorkspace, canManageWorkspace } from '../authorization.js';
import { durationMinutesFromLegacyFields } from '../domain/project-schedule-v2.js';
import { canonicalizeWbsV2, WbsV2ValidationError } from '../domain/wbs-v2.js';
import { calendarFromMetadata } from '../domain/work-calendar.js';
import { withTenant } from '../tenant-transaction.js';

const paramsSchema = z.object({ projectId: z.string().uuid() });
const updateBodySchema = z.object({
  items: z.array(z.object({
    objectId: z.string().uuid(),
    parentWorkItemId: z.string().uuid().nullable().optional(),
  })).max(5000),
});

function asRecord(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, Prisma.JsonValue>;
}

function projectIdFromMetadata(value: Prisma.JsonValue | null): string | null {
  const metadata = asRecord(value);
  return typeof metadata.projectId === 'string' ? metadata.projectId : null;
}

function dateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

async function loadProjectWorkItems(
  tx: Prisma.TransactionClient,
  tenantId: string,
  workspaceId: string,
  projectId: string,
) {
  const candidates = await tx.nexusObject.findMany({
    where: {
      tenantId,
      workspaceId,
      deletedAt: null,
      objectTypeKey: { in: ['TASK', 'DELIVERABLE', 'MILESTONE'] },
    },
    select: {
      id: true,
      title: true,
      objectTypeKey: true,
      status: true,
      priority: true,
      progress: true,
      assigneeId: true,
      startDate: true,
      dueDate: true,
      metadata: true,
      createdAt: true,
      assignee: { select: { fullName: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return candidates.filter((object) => projectIdFromMetadata(object.metadata) === projectId);
}

export async function wbsV2Routes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/projects/:projectId/wbs-v2',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;

      const result = await withTenant(actor.tenantId, async (tx) => {
        const project = await tx.nexusObject.findFirst({
          where: {
            id: params.data.projectId,
            tenantId: actor.tenantId,
            objectTypeKey: 'PROJECT',
            deletedAt: null,
          },
          select: {
            id: true,
            title: true,
            workspaceId: true,
            startDate: true,
            dueDate: true,
            metadata: true,
          },
        });
        if (!project) return { kind: 'not_found' as const };
        if (!(await canAccessWorkspace(tx, actor, project.workspaceId))) {
          return { kind: 'forbidden' as const };
        }

        const [objects, schedules, profile] = await Promise.all([
          loadProjectWorkItems(tx, actor.tenantId, project.workspaceId, project.id),
          tx.workItemSchedule.findMany({
            where: { tenantId: actor.tenantId, projectObjectId: project.id },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          }),
          tx.projectScheduleProfile.findUnique({ where: { projectObjectId: project.id } }),
        ]);

        const objectById = new Map(objects.map((object) => [object.id, object]));
        const scheduleById = new Map(schedules.map((schedule) => [schedule.objectId, schedule]));
        const orderedObjectIds = [...objects]
          .sort((a, b) => {
            const aSchedule = scheduleById.get(a.id);
            const bSchedule = scheduleById.get(b.id);
            if (aSchedule && bSchedule && aSchedule.sortOrder !== bSchedule.sortOrder) {
              return aSchedule.sortOrder - bSchedule.sortOrder;
            }
            if (aSchedule && !bSchedule) return -1;
            if (!aSchedule && bSchedule) return 1;
            return a.createdAt.getTime() - b.createdAt.getTime();
          })
          .map((object) => object.id);

        let canonical;
        try {
          canonical = canonicalizeWbsV2(orderedObjectIds.map((objectId) => ({
            objectId,
            parentWorkItemId: scheduleById.get(objectId)?.parentWorkItemId ?? null,
          })));
        } catch (error) {
          if (error instanceof WbsV2ValidationError) {
            return { kind: 'invalid' as const, message: error.message };
          }
          throw error;
        }

        const legacyCalendar = calendarFromMetadata(project.metadata);
        const minutesPerDay = profile?.minutesPerDay ?? 480;
        const nodes = canonical.map((node) => {
          const object = objectById.get(node.objectId)!;
          const schedule = scheduleById.get(node.objectId);
          const fallbackDuration = durationMinutesFromLegacyFields(
            {
              startDate: object.startDate,
              dueDate: object.dueDate,
              objectTypeKey: object.objectTypeKey,
            },
            legacyCalendar,
            minutesPerDay,
          ) ?? 0;
          const remainingFallback = Math.max(
            0,
            Math.round(fallbackDuration * (100 - Math.max(0, Math.min(100, object.progress))) / 100),
          );

          return {
            objectId: object.id,
            title: object.title,
            objectTypeKey: object.objectTypeKey,
            status: object.status,
            priority: object.priority,
            progress: object.progress,
            assigneeId: object.assigneeId,
            assigneeName: object.assignee?.fullName ?? null,
            parentWorkItemId: node.parentWorkItemId,
            outlineLevel: node.outlineLevel,
            sortOrder: node.sortOrder,
            wbsCode: node.wbsCode,
            isSummary: node.isSummary,
            source: schedule ? 'V2' as const : 'V1_FALLBACK' as const,
            schedulingMode: schedule?.schedulingMode ?? 'AUTO',
            durationMinutes: schedule?.durationMinutes ?? fallbackDuration,
            remainingDurationMinutes: schedule?.remainingDurationMinutes ?? remainingFallback,
            constraintType: schedule?.constraintType ?? 'AS_SOON_AS_POSSIBLE',
            constraintDate: dateOnly(schedule?.constraintDate),
            actualStart: dateOnly(schedule?.actualStart),
            actualFinish: dateOnly(schedule?.actualFinish),
            physicalPercentComplete: schedule?.physicalPercentComplete == null
              ? null
              : Number(schedule.physicalPercentComplete),
            legacyStart: dateOnly(object.startDate),
            legacyFinish: dateOnly(object.dueDate),
          };
        });

        return {
          kind: 'ok' as const,
          payload: {
            project: {
              id: project.id,
              title: project.title,
              workspaceId: project.workspaceId,
              plannedStart: dateOnly(profile?.plannedStart ?? project.startDate),
              targetFinish: dateOnly(profile?.targetFinish ?? project.dueDate),
            },
            minutesPerDay,
            nodes,
            migration: {
              total: nodes.length,
              typed: nodes.filter((node) => node.source === 'V2').length,
              fallback: nodes.filter((node) => node.source === 'V1_FALLBACK').length,
            },
          },
        };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'project_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
      if (result.kind === 'invalid') {
        return reply.code(422).send({ error: 'invalid_wbs', message: result.message });
      }
      return result.payload;
    },
  );

  app.put(
    '/api/v1/projects/:projectId/wbs-v2',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      const body = updateBodySchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: 'validation_error' });
      }
      const actor = request.actor!;

      const result = await withTenant(actor.tenantId, async (tx) => {
        const project = await tx.nexusObject.findFirst({
          where: {
            id: params.data.projectId,
            tenantId: actor.tenantId,
            objectTypeKey: 'PROJECT',
            deletedAt: null,
          },
          select: { id: true, workspaceId: true, metadata: true },
        });
        if (!project) return { kind: 'not_found' as const };
        if (!(await canManageWorkspace(tx, actor, project.workspaceId))) {
          return { kind: 'forbidden' as const };
        }

        const objects = await loadProjectWorkItems(
          tx,
          actor.tenantId,
          project.workspaceId,
          project.id,
        );
        const projectIds = new Set(objects.map((object) => object.id));
        const requestedIds = new Set(body.data.items.map((item) => item.objectId));
        const missing = [...projectIds].filter((id) => !requestedIds.has(id));
        const unexpected = [...requestedIds].filter((id) => !projectIds.has(id));
        if (missing.length > 0 || unexpected.length > 0) {
          return { kind: 'membership_mismatch' as const, missing, unexpected };
        }

        let canonical;
        try {
          canonical = canonicalizeWbsV2(body.data.items.map((item) => ({
            objectId: item.objectId,
            ...(item.parentWorkItemId !== undefined
              ? { parentWorkItemId: item.parentWorkItemId }
              : {}),
          })));
        } catch (error) {
          if (error instanceof WbsV2ValidationError) {
            return { kind: 'invalid' as const, message: error.message };
          }
          throw error;
        }

        const [existingSchedules, profile] = await Promise.all([
          tx.workItemSchedule.findMany({
            where: { tenantId: actor.tenantId, projectObjectId: project.id },
          }),
          tx.projectScheduleProfile.findUnique({ where: { projectObjectId: project.id } }),
        ]);
        const existingById = new Map(existingSchedules.map((schedule) => [schedule.objectId, schedule]));
        const objectById = new Map(objects.map((object) => [object.id, object]));
        const legacyCalendar = calendarFromMetadata(project.metadata);
        const minutesPerDay = profile?.minutesPerDay ?? 480;

        let createdCount = 0;
        let updatedCount = 0;
        for (const item of canonical) {
          const object = objectById.get(item.objectId)!;
          const existing = existingById.get(item.objectId);
          if (existing) {
            await tx.workItemSchedule.update({
              where: { id: existing.id },
              data: {
                parentWorkItemId: item.parentWorkItemId,
                outlineLevel: item.outlineLevel,
                sortOrder: item.sortOrder,
                wbsCode: item.wbsCode,
              },
            });
            updatedCount += 1;
            continue;
          }

          const durationMinutes = durationMinutesFromLegacyFields(
            {
              startDate: object.startDate,
              dueDate: object.dueDate,
              objectTypeKey: object.objectTypeKey,
            },
            legacyCalendar,
            minutesPerDay,
          ) ?? (object.objectTypeKey === 'MILESTONE' ? 0 : minutesPerDay);
          const remainingDurationMinutes = Math.max(
            0,
            Math.min(
              durationMinutes,
              Math.round(durationMinutes * (100 - Math.max(0, Math.min(100, object.progress))) / 100),
            ),
          );

          await tx.workItemSchedule.create({
            data: {
              tenantId: actor.tenantId,
              projectObjectId: project.id,
              objectId: object.id,
              parentWorkItemId: item.parentWorkItemId,
              wbsCode: item.wbsCode,
              outlineLevel: item.outlineLevel,
              sortOrder: item.sortOrder,
              schedulingMode: 'AUTO',
              durationMinutes,
              remainingDurationMinutes,
              constraintType: 'AS_SOON_AS_POSSIBLE',
            },
          });
          createdCount += 1;
        }

        await Promise.all([
          tx.domainEvent.create({
            data: {
              tenantId: actor.tenantId,
              aggregateId: project.id,
              eventType: 'bridata.project.wbs.updated',
              payload: {
                projectId: project.id,
                itemCount: canonical.length,
                createdScheduleCount: createdCount,
                updatedScheduleCount: updatedCount,
                actorId: actor.userId,
              },
            },
          }),
          tx.auditLog.create({
            data: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              action: 'PROJECT_WBS_UPDATED',
              resource: 'PROJECT_SCHEDULE',
              resourceId: project.id,
              correlationId: request.id,
              ipAddress: request.ip,
              details: {
                itemCount: canonical.length,
                createdScheduleCount: createdCount,
                updatedScheduleCount: updatedCount,
              },
            },
          }),
        ]);

        return {
          kind: 'ok' as const,
          payload: {
            projectId: project.id,
            itemCount: canonical.length,
            createdScheduleCount: createdCount,
            updatedScheduleCount: updatedCount,
            items: canonical,
          },
        };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'project_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'wbs_management_denied' });
      if (result.kind === 'membership_mismatch') {
        return reply.code(409).send({
          error: 'wbs_membership_mismatch',
          message: 'The WBS request must contain every active schedulable object in the project exactly once.',
          details: { missing: result.missing, unexpected: result.unexpected },
        });
      }
      if (result.kind === 'invalid') {
        return reply.code(422).send({ error: 'invalid_wbs', message: result.message });
      }
      return result.payload;
    },
  );
}
