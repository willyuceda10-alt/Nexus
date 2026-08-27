import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canAccessWorkspace } from '../authorization.js';
import {
  calculateCpm,
  ScheduleCycleError,
  ScheduleValidationError,
  type DependencyType,
} from '../domain/scheduling.js';
import {
  calendarFromMetadata,
  durationUnits,
  type ScheduleCalendarConfig,
} from '../domain/work-calendar.js';
import { withTenant } from '../tenant-transaction.js';

const querySchema = z.object({
  projectId: z.string().uuid(),
});

const dependencyTypeSchema = z.enum(['FS', 'SS', 'FF', 'SF']);

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

function durationForObject(
  objectTypeKey: string,
  startDate: Date | null,
  dueDate: Date | null,
  calendar: ScheduleCalendarConfig,
  typedDurationMinutes: number | undefined,
  minutesPerDay: number,
): number | null {
  if (typedDurationMinutes !== undefined) {
    if (objectTypeKey === 'MILESTONE') return 0;
    return typedDurationMinutes / Math.max(1, minutesPerDay);
  }

  if (!startDate && !dueDate) return null;
  if (objectTypeKey === 'MILESTONE') return 0;

  const start = startDate ?? dueDate!;
  const endCandidate = dueDate ?? start;
  return durationUnits(start, endCandidate, calendar);
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
          select: { id: true, workspaceId: true, metadata: true },
        });
        if (!project) return { kind: 'not_found' as const };
        if (!(await canAccessWorkspace(tx, actor, project.workspaceId))) {
          return { kind: 'forbidden' as const };
        }

        // Calendar date arithmetic remains V1-compatible in this transition.
        // V2 already owns explicit durations in minutes; calendar exception
        // arithmetic will move to the V2 calendar engine in the next phase.
        const calendar = calendarFromMetadata(project.metadata);

        const [profile, candidateObjects] = await Promise.all([
          tx.projectScheduleProfile.findUnique({
            where: { projectObjectId: project.id },
            select: { minutesPerDay: true },
          }),
          tx.nexusObject.findMany({
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
          }),
        ]);

        const projectObjects = candidateObjects.filter(
          (object) => projectIdFromMetadata(object.metadata) === project.id,
        );
        const projectObjectIds = new Set(projectObjects.map((object) => object.id));
        const typedSchedules = await tx.workItemSchedule.findMany({
          where: {
            tenantId: actor.tenantId,
            projectObjectId: project.id,
            objectId: { in: [...projectObjectIds] },
          },
          select: {
            objectId: true,
            durationMinutes: true,
            constraintType: true,
            constraintDate: true,
          },
        });
        const typedByObjectId = new Map(typedSchedules.map((row) => [row.objectId, row]));
        const minutesPerDay = profile?.minutesPerDay ?? 480;

        const scheduled = projectObjects
          .map((object) => {
            const typed = typedByObjectId.get(object.id);
            return {
              object,
              source: typed ? 'V2' as const : 'V1_FALLBACK' as const,
              constraintType: typed?.constraintType ?? 'AS_SOON_AS_POSSIBLE',
              constraintDate: typed?.constraintDate ?? null,
              durationDays: durationForObject(
                object.objectTypeKey,
                object.startDate,
                object.dueDate,
                calendar,
                typed?.durationMinutes,
                minutesPerDay,
              ),
            };
          })
          .filter(
            (entry): entry is typeof entry & { durationDays: number } =>
              entry.durationDays !== null,
          );
        const scheduledIds = new Set(scheduled.map((entry) => entry.object.id));

        // Dependencies remain read from V1 ObjectRelation during the dual-write
        // migration. This keeps current Gantt behavior stable while V2 rows fill.
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
              engineVersion: 2,
              projectId: project.id,
              workspaceId: project.workspaceId,
              calendar: calendar.mode,
              calendarSource: 'V1_COMPATIBILITY' as const,
              workingWeekdays: calendar.workingWeekdays,
              holidays: calendar.holidays,
              minutesPerDay,
              projectDurationDays: analysis.projectDurationDays,
              criticalTaskIds: analysis.criticalTaskIds,
              topologicalOrder: analysis.topologicalOrder,
              tasks: analysis.tasks.map((task) => {
                const scheduledEntry = scheduled.find((entry) => entry.object.id === task.id)!;
                return {
                  ...task,
                  title: scheduledEntry.object.title,
                  objectTypeKey: scheduledEntry.object.objectTypeKey,
                  scheduleSource: scheduledEntry.source,
                  constraintType: scheduledEntry.constraintType,
                  constraintDate: scheduledEntry.constraintDate
                    ? scheduledEntry.constraintDate.toISOString().slice(0, 10)
                    : null,
                  constraintAppliedToCpm: false,
                };
              }),
              dependencies,
              unscheduledObjectIds: projectObjects
                .filter((object) => !scheduledIds.has(object.id))
                .map((object) => object.id),
              migration: {
                typedWorkItems: scheduled.filter((entry) => entry.source === 'V2').length,
                fallbackWorkItems: scheduled.filter((entry) => entry.source === 'V1_FALLBACK').length,
                dependencyReadSource: 'V1_DUAL_WRITE_TRANSITION' as const,
              },
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
