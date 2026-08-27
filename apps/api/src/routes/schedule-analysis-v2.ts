import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canAccessWorkspace } from '../authorization.js';
import { durationMinutesFromLegacyFields } from '../domain/project-schedule-v2.js';
import {
  calculateScheduleV2,
  ScheduleEngineV2CycleError,
  ScheduleEngineV2ValidationError,
} from '../domain/scheduling-v2.js';
import {
  WorkCalendarV2ValidationError,
  workingMinutesBetweenDatesV2,
  type WorkCalendarV2,
} from '../domain/work-calendar-v2.js';
import { calendarFromMetadata } from '../domain/work-calendar.js';
import { withTenant } from '../tenant-transaction.js';

const paramsSchema = z.object({ projectId: z.string().uuid() });
const dependencyTypeSchema = z.enum(['FS', 'SS', 'FF', 'SF']);

function jsonRecord(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, Prisma.JsonValue>;
}

function projectIdFromMetadata(value: Prisma.JsonValue | null): string | null {
  const metadata = jsonRecord(value);
  return typeof metadata.projectId === 'string' ? metadata.projectId : null;
}

function legacyDependencyMetadata(value: Prisma.JsonValue | null): { type: 'FS' | 'SS' | 'FF' | 'SF'; lagDays: number } {
  const metadata = jsonRecord(value);
  const type = dependencyTypeSchema.safeParse(metadata.dependencyType);
  return {
    type: type.success ? type.data : 'FS',
    lagDays: typeof metadata.lagDays === 'number' && Number.isFinite(metadata.lagDays)
      ? Math.trunc(metadata.lagDays)
      : 0,
  };
}

function legacyCalendar(
  metadata: Prisma.JsonValue | null,
  minutesPerDay: number,
): WorkCalendarV2 {
  const v1 = calendarFromMetadata(metadata);
  return {
    timezone: 'UTC',
    workingWeekdays: v1.mode === 'CALENDAR_DAYS_V1' ? [0, 1, 2, 3, 4, 5, 6] : v1.workingWeekdays,
    minutesPerDay,
    exceptions: v1.holidays.map((date) => ({
      exceptionDate: new Date(`${date}T00:00:00.000Z`),
      isWorking: false,
      workingMinutes: 0,
    })),
  };
}

function fallbackDurationMinutes(
  object: {
    objectTypeKey: string;
    startDate: Date | null;
    dueDate: Date | null;
  },
  projectMetadata: Prisma.JsonValue | null,
  calendar: WorkCalendarV2,
  minutesPerDay: number,
  typedCalendarActive: boolean,
): number | null {
  if (!object.startDate && !object.dueDate) return null;
  if (object.objectTypeKey === 'MILESTONE') return 0;

  if (typedCalendarActive) {
    const start = object.startDate ?? object.dueDate!;
    const finish = object.dueDate ?? start;
    return Math.max(minutesPerDay, workingMinutesBetweenDatesV2(start, finish, calendar));
  }

  return durationMinutesFromLegacyFields(
    {
      startDate: object.startDate,
      dueDate: object.dueDate,
      objectTypeKey: object.objectTypeKey,
    },
    calendarFromMetadata(projectMetadata),
    minutesPerDay,
  );
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export async function scheduleAnalysisV2Routes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/projects/:projectId/schedule-analysis-v2',
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
            workspaceId: true,
            title: true,
            startDate: true,
            dueDate: true,
            metadata: true,
          },
        });
        if (!project) return { kind: 'not_found' as const };
        if (!(await canAccessWorkspace(tx, actor, project.workspaceId))) {
          return { kind: 'forbidden' as const };
        }

        const profile = await tx.projectScheduleProfile.findUnique({
          where: { projectObjectId: project.id },
        });

        const typedCalendar = profile?.calendarId
          ? await tx.workCalendar.findFirst({
              where: { id: profile.calendarId, tenantId: actor.tenantId, workspaceId: project.workspaceId },
              include: { exceptions: true },
            })
          : null;

        const minutesPerDay = profile?.minutesPerDay ?? typedCalendar?.minutesPerDay ?? 480;
        const calendar: WorkCalendarV2 = typedCalendar
          ? {
              timezone: typedCalendar.timezone,
              workingWeekdays: typedCalendar.workingWeekdays,
              minutesPerDay: typedCalendar.minutesPerDay,
              exceptions: typedCalendar.exceptions.map((entry) => ({
                exceptionDate: entry.exceptionDate,
                isWorking: entry.isWorking,
                workingMinutes: entry.workingMinutes,
              })),
            }
          : legacyCalendar(project.metadata, minutesPerDay);

        const candidates = await tx.nexusObject.findMany({
          where: {
            tenantId: actor.tenantId,
            workspaceId: project.workspaceId,
            deletedAt: null,
            objectTypeKey: { in: ['TASK', 'DELIVERABLE', 'MILESTONE'] },
          },
          select: {
            id: true,
            title: true,
            objectTypeKey: true,
            startDate: true,
            dueDate: true,
            metadata: true,
          },
        });
        const projectObjects = candidates.filter((object) => projectIdFromMetadata(object.metadata) === project.id);
        const objectIds = projectObjects.map((object) => object.id);

        const typedSchedules = objectIds.length === 0
          ? []
          : await tx.workItemSchedule.findMany({
              where: {
                tenantId: actor.tenantId,
                projectObjectId: project.id,
                objectId: { in: objectIds },
              },
            });
        const scheduleByObject = new Map(typedSchedules.map((schedule) => [schedule.objectId, schedule]));

        const tasks = projectObjects.flatMap((object) => {
          const typed = scheduleByObject.get(object.id);
          const durationMinutes = typed?.durationMinutes ?? fallbackDurationMinutes(
            object,
            project.metadata,
            calendar,
            minutesPerDay,
            Boolean(typedCalendar),
          );
          if (durationMinutes === null) return [];
          return [{
            id: object.id,
            title: object.title,
            durationMinutes,
            schedulingMode: typed?.schedulingMode ?? 'AUTO' as const,
            constraintType: typed?.constraintType ?? 'AS_SOON_AS_POSSIBLE' as const,
            ...(typed?.constraintDate ? { constraintDate: typed.constraintDate } : {}),
            scheduleSource: typed ? 'V2' as const : 'V1_FALLBACK' as const,
          }];
        });
        const scheduledIds = new Set(tasks.map((task) => task.id));

        const [typedDependencies, legacyRelations] = objectIds.length === 0
          ? [[], []]
          : await Promise.all([
              tx.scheduleDependencyV2.findMany({
                where: { tenantId: actor.tenantId, projectObjectId: project.id },
              }),
              tx.objectRelation.findMany({
                where: {
                  tenantId: actor.tenantId,
                  relationType: 'DEPENDS_ON',
                  sourceObjectId: { in: objectIds },
                  targetObjectId: { in: objectIds },
                },
                select: { id: true, sourceObjectId: true, targetObjectId: true, metadata: true },
              }),
            ]);

        const edgeKeys = new Set<string>();
        const dependencies: Array<{
          id?: string;
          predecessorId: string;
          successorId: string;
          type: 'FS' | 'SS' | 'FF' | 'SF';
          lagMinutes: number;
          source: 'V2' | 'V1_FALLBACK';
        }> = [];

        for (const dependency of typedDependencies) {
          if (!scheduledIds.has(dependency.predecessorObjectId) || !scheduledIds.has(dependency.successorObjectId)) continue;
          const key = `${dependency.predecessorObjectId}:${dependency.successorObjectId}`;
          edgeKeys.add(key);
          dependencies.push({
            id: dependency.id,
            predecessorId: dependency.predecessorObjectId,
            successorId: dependency.successorObjectId,
            type: dependency.dependencyType,
            lagMinutes: dependency.lagMinutes,
            source: 'V2',
          });
        }

        for (const relation of legacyRelations) {
          if (!scheduledIds.has(relation.targetObjectId) || !scheduledIds.has(relation.sourceObjectId)) continue;
          const key = `${relation.targetObjectId}:${relation.sourceObjectId}`;
          if (edgeKeys.has(key)) continue;
          const metadata = legacyDependencyMetadata(relation.metadata);
          dependencies.push({
            id: relation.id,
            predecessorId: relation.targetObjectId,
            successorId: relation.sourceObjectId,
            type: metadata.type,
            lagMinutes: metadata.lagDays * minutesPerDay,
            source: 'V1_FALLBACK',
          });
        }

        const anchorCandidates = [
          profile?.plannedStart,
          project.startDate,
          ...projectObjects.map((object) => object.startDate),
        ].filter((value): value is Date => Boolean(value));
        if (anchorCandidates.length === 0) {
          return { kind: 'anchor_missing' as const };
        }
        const anchorDate = new Date(Math.min(...anchorCandidates.map((value) => value.getTime())));
        const targetFinish = profile?.targetFinish ?? project.dueDate ?? undefined;

        try {
          const analysis = calculateScheduleV2({
            anchorDate,
            ...(targetFinish ? { targetFinish } : {}),
            calendar,
            tasks: tasks.map(({ scheduleSource: _source, ...task }) => task),
            dependencies: dependencies.map(({ source: _source, ...dependency }) => dependency),
          });
          const sourceByTask = new Map(tasks.map((task) => [task.id, task.scheduleSource]));
          const dependencySource = new Map(
            dependencies.map((dependency) => [
              `${dependency.predecessorId}:${dependency.successorId}`,
              dependency.source,
            ]),
          );

          return {
            kind: 'ok' as const,
            payload: {
              projectId: project.id,
              projectTitle: project.title,
              workspaceId: project.workspaceId,
              profileSource: profile ? 'V2' as const : 'V1_FALLBACK' as const,
              calendar: {
                id: typedCalendar?.id ?? null,
                source: typedCalendar ? 'V2' as const : 'V1_FALLBACK' as const,
                timezone: calendar.timezone,
                workingWeekdays: calendar.workingWeekdays,
                minutesPerDay: calendar.minutesPerDay,
                exceptionCount: calendar.exceptions.length,
                timeResolution: 'WORKING_MINUTES_DATE_BUCKETED_V2' as const,
              },
              migration: {
                totalWorkItems: projectObjects.length,
                v2WorkItems: typedSchedules.length,
                fallbackWorkItems: projectObjects.length - typedSchedules.length,
                v2Dependencies: dependencies.filter((dependency) => dependency.source === 'V2').length,
                fallbackDependencies: dependencies.filter((dependency) => dependency.source === 'V1_FALLBACK').length,
              },
              ...analysis,
              tasks: analysis.tasks.map((task) => ({
                ...task,
                scheduleSource: sourceByTask.get(task.id) ?? 'V1_FALLBACK',
              })),
              dependencies: dependencies.map((dependency) => ({
                ...dependency,
                source: dependencySource.get(`${dependency.predecessorId}:${dependency.successorId}`) ?? dependency.source,
              })),
              unscheduledObjectIds: projectObjects
                .filter((object) => !scheduledIds.has(object.id))
                .map((object) => object.id),
              calculatedAt: new Date().toISOString(),
              anchorDate: dateOnly(anchorDate),
            },
          };
        } catch (error) {
          if (error instanceof ScheduleEngineV2CycleError) {
            return { kind: 'cycle' as const, cycleNodeIds: error.cycleNodeIds };
          }
          if (
            error instanceof ScheduleEngineV2ValidationError ||
            error instanceof WorkCalendarV2ValidationError
          ) {
            return { kind: 'invalid' as const, message: error.message };
          }
          throw error;
        }
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'project_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
      if (result.kind === 'anchor_missing') {
        return reply.code(422).send({
          error: 'schedule_anchor_missing',
          message: 'Project Engine V2 needs a planned project start or at least one scheduled work-item start date.',
        });
      }
      if (result.kind === 'cycle') {
        return reply.code(409).send({
          error: 'dependency_cycle',
          message: 'The Project Engine V2 dependency graph contains a cycle.',
          details: { cycleNodeIds: result.cycleNodeIds },
        });
      }
      if (result.kind === 'invalid') {
        return reply.code(422).send({ error: 'invalid_schedule_v2', message: result.message });
      }
      return result.payload;
    },
  );
}
