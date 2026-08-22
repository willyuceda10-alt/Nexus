import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor, type ActorContext } from '../auth.js';
import {
  calculateCpm,
  ScheduleCycleError,
  ScheduleValidationError,
  type DependencyType,
} from '../domain/scheduling.js';
import { withTenant } from '../tenant-transaction.js';

const querySchema = z.object({
  projectId: z.string().uuid(),
});

const dependencyTypeSchema = z.enum(['FS', 'SS', 'FF', 'SF']);
const DAY_MS = 86_400_000;

function isTenantAdmin(actor: ActorContext): boolean {
  return actor.role === 'OWNER' || actor.role === 'TENANT_ADMIN';
}

async function canAccessWorkspace(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  workspaceId: string,
): Promise<boolean> {
  if (isTenantAdmin(actor)) return true;
  const membership = await tx.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: actor.userId } },
    select: { tenantId: true },
  });
  return membership?.tenantId === actor.tenantId;
}

function jsonRecord(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, Prisma.JsonValue>;
}

function dependencyMetadata(value: Prisma.JsonValue | null): {
  type: DependencyType;
  lagDays: number;
} {
  const metadata = jsonRecord(value);
  const parsedType = dependencyTypeSchema.safeParse(metadata.dependencyType);
  return {
    type: parsedType.success ? parsedType.data : 'FS',
    lagDays: typeof metadata.lagDays === 'number' && Number.isFinite(metadata.lagDays)
      ? Math.trunc(metadata.lagDays)
      : 0,
  };
}

function projectIdFromMetadata(value: Prisma.JsonValue | null): string | null {
  const metadata = jsonRecord(value);
  return typeof metadata.projectId === 'string' ? metadata.projectId : null;
}

function durationDays(
  objectTypeKey: string,
  startDate: Date | null,
  dueDate: Date | null,
): number | null {
  if (!startDate && !dueDate) return null;
  if (objectTypeKey === 'MILESTONE') return 0;

  const start = startDate ?? dueDate!;
  const endCandidate = dueDate ?? start;
  const end = endCandidate.getTime() < start.getTime() ? start : endCandidate;
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1);
}

export async function scheduleAnalysisRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/schedule-analysis',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const parsed = querySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() });
      }

      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const project = await tx.nexusObject.findFirst({
          where: {
            id: parsed.data.projectId,
            tenantId: actor.tenantId,
            objectTypeKey: 'PROJECT',
            deletedAt: null,
          },
          select: { id: true, workspaceId: true },
        });
        if (!project) return { kind: 'not_found' as const };
        if (!(await canAccessWorkspace(tx, actor, project.workspaceId))) {
          return { kind: 'forbidden' as const };
        }

        const candidateObjects = await tx.nexusObject.findMany({
          where: {
            tenantId: actor.tenantId,
            workspaceId: project.workspaceId,
            deletedAt: null,
            objectTypeKey: { in: ['TASK', 'DELIVERABLE', 'MILESTONE'] },
          },
          select: {
            id: true,
            objectTypeKey: true,
            title: true,
            startDate: true,
            dueDate: true,
            metadata: true,
          },
        });

        const projectObjects = candidateObjects.filter(
          (object) => projectIdFromMetadata(object.metadata) === project.id,
        );
        const projectObjectIds = new Set(projectObjects.map((object) => object.id));

        const scheduled = projectObjects
          .map((object) => ({
            object,
            durationDays: durationDays(object.objectTypeKey, object.startDate, object.dueDate),
          }))
          .filter(
            (entry): entry is typeof entry & { durationDays: number } =>
              entry.durationDays !== null,
          );
        const scheduledIds = new Set(scheduled.map((entry) => entry.object.id));

        const relationRows = projectObjectIds.size === 0
          ? []
          : await tx.objectRelation.findMany({
              where: {
                tenantId: actor.tenantId,
                relationType: 'DEPENDS_ON',
                sourceObjectId: { in: [...projectObjectIds] },
                targetObjectId: { in: [...projectObjectIds] },
              },
              select: {
                id: true,
                sourceObjectId: true,
                targetObjectId: true,
                metadata: true,
              },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            });

        const dependencies = relationRows
          .filter(
            (relation) => scheduledIds.has(relation.sourceObjectId) && scheduledIds.has(relation.targetObjectId),
          )
          .map((relation) => {
            const metadata = dependencyMetadata(relation.metadata);
            return {
              id: relation.id,
              predecessorId: relation.targetObjectId,
              successorId: relation.sourceObjectId,
              type: metadata.type,
              lagDays: metadata.lagDays,
            };
          });

        try {
          const analysis = calculateCpm(
            scheduled.map((entry) => ({
              id: entry.object.id,
              durationDays: entry.durationDays,
            })),
            dependencies.map(({ predecessorId, successorId, type, lagDays }) => ({
              predecessorId,
              successorId,
              type,
              lagDays,
            })),
          );

          return {
            kind: 'ok' as const,
            analysis: {
              projectId: project.id,
              workspaceId: project.workspaceId,
              calendar: 'CALENDAR_DAYS_V1' as const,
              projectDurationDays: analysis.projectDurationDays,
              criticalTaskIds: analysis.criticalTaskIds,
              topologicalOrder: analysis.topologicalOrder,
              tasks: analysis.tasks.map((task) => {
                const object = scheduled.find((entry) => entry.object.id === task.id)!.object;
                return {
                  ...task,
                  title: object.title,
                  objectTypeKey: object.objectTypeKey,
                };
              }),
              dependencies,
              unscheduledObjectIds: projectObjects
                .filter((object) => !scheduledIds.has(object.id))
                .map((object) => object.id),
            },
          };
        } catch (error) {
          if (error instanceof ScheduleCycleError) {
            return {
              kind: 'cycle' as const,
              cycleNodeIds: error.cycleNodeIds,
            };
          }
          if (error instanceof ScheduleValidationError) {
            return { kind: 'invalid' as const, message: error.message };
          }
          throw error;
        }
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'project_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
      if (result.kind === 'cycle') {
        return reply.code(409).send({
          error: 'dependency_cycle',
          message: 'The project dependency graph contains a cycle.',
          details: { cycleNodeIds: result.cycleNodeIds },
        });
      }
      if (result.kind === 'invalid') {
        return reply.code(422).send({ error: 'invalid_schedule', message: result.message });
      }

      return result.analysis;
    },
  );
}
