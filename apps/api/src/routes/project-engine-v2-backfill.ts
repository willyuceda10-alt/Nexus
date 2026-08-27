import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import {
  canManageWorkspace,
  isTenantAdministrator,
} from '../authorization.js';
import { durationMinutesFromLegacyFields } from '../domain/project-schedule-v2.js';
import { calendarFromMetadata } from '../domain/work-calendar.js';
import { withTenant } from '../tenant-transaction.js';

const bodySchema = z.object({
  projectId: z.string().uuid().optional(),
  dryRun: z.boolean().default(true),
});
const dependencyTypeSchema = z.enum(['FS', 'SS', 'FF', 'SF']);

type BackfillState = 'existing' | 'planned' | 'created' | 'updated';

function asRecord(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, Prisma.JsonValue>;
}

function projectIdFromMetadata(value: Prisma.JsonValue | null): string | null {
  const metadata = asRecord(value);
  return typeof metadata.projectId === 'string' ? metadata.projectId : null;
}

function dependencyMetadata(value: Prisma.JsonValue | null): {
  type: 'FS' | 'SS' | 'FF' | 'SF';
  lagDays: number;
} {
  const metadata = asRecord(value);
  const parsed = dependencyTypeSchema.safeParse(metadata.dependencyType);
  return {
    type: parsed.success ? parsed.data : 'FS',
    lagDays: typeof metadata.lagDays === 'number' && Number.isFinite(metadata.lagDays)
      ? Math.trunc(metadata.lagDays)
      : 0,
  };
}

function legacyMinutesPerDay(metadata: Prisma.JsonValue | null): number {
  const record = asRecord(metadata);
  const candidate = record.scheduleMinutesPerDay;
  return typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0 && candidate <= 1440
    ? candidate
    : 480;
}

export async function projectEngineV2BackfillRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/v1/project-engine-v2/backfill',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const parsed = bodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() });
      }
      const actor = request.actor!;
      const { projectId, dryRun } = parsed.data;

      if (!projectId && !isTenantAdministrator(actor)) {
        return reply.code(403).send({
          error: 'tenant_backfill_requires_admin',
          message: 'Tenant-wide Project Engine V2 backfill requires OWNER or TENANT_ADMIN.',
        });
      }

      const result = await withTenant(actor.tenantId, async (tx) => {
        const projects = await tx.nexusObject.findMany({
          where: {
            tenantId: actor.tenantId,
            objectTypeKey: 'PROJECT',
            deletedAt: null,
            ...(projectId ? { id: projectId } : {}),
          },
          select: {
            id: true,
            workspaceId: true,
            title: true,
            startDate: true,
            dueDate: true,
            metadata: true,
          },
          orderBy: { createdAt: 'asc' },
        });
        if (projectId && projects.length === 0) return { kind: 'not_found' as const };

        const summaries: Array<{
          projectId: string;
          projectTitle: string;
          calendar: BackfillState;
          profile: BackfillState;
          workItemsPlanned: number;
          workItemsCreated: number;
          workItemsSkippedExisting: number;
          workItemsSkippedUnscheduled: number;
          dependenciesPlanned: number;
          dependenciesCreated: number;
          dependenciesSkippedExisting: number;
        }> = [];

        for (const project of projects) {
          if (!(await canManageWorkspace(tx, actor, project.workspaceId))) {
            if (projectId) return { kind: 'forbidden' as const };
            continue;
          }

          const currentProfile = await tx.projectScheduleProfile.findUnique({
            where: { projectObjectId: project.id },
          });
          const legacy = calendarFromMetadata(project.metadata);
          const minutesPerDay = currentProfile?.minutesPerDay ?? legacyMinutesPerDay(project.metadata);
          const calendarName = `Migrado V1 · ${project.id.slice(0, 8)}`;

          let calendar = currentProfile?.calendarId
            ? await tx.workCalendar.findFirst({
                where: {
                  id: currentProfile.calendarId,
                  tenantId: actor.tenantId,
                  workspaceId: project.workspaceId,
                },
              })
            : null;
          if (!calendar) {
            calendar = await tx.workCalendar.findFirst({
              where: {
                tenantId: actor.tenantId,
                workspaceId: project.workspaceId,
                name: calendarName,
              },
            });
          }

          let calendarState: BackfillState = calendar ? 'existing' : 'planned';
          if (!calendar && !dryRun) {
            calendar = await tx.workCalendar.create({
              data: {
                tenantId: actor.tenantId,
                workspaceId: project.workspaceId,
                name: calendarName,
                timezone: currentProfile?.timezone ?? 'UTC',
                workingWeekdays: legacy.mode === 'CALENDAR_DAYS_V1'
                  ? [0, 1, 2, 3, 4, 5, 6]
                  : legacy.workingWeekdays,
                minutesPerDay,
                isDefault: false,
              },
            });
            calendarState = 'created';
          }

          // Always upsert legacy holidays when the migrated calendar exists. This
          // makes reruns repair a partially completed previous backfill.
          if (calendar && !dryRun) {
            for (const holiday of legacy.holidays) {
              const exceptionDate = new Date(`${holiday}T00:00:00.000Z`);
              await tx.workCalendarException.upsert({
                where: { calendarId_exceptionDate: { calendarId: calendar.id, exceptionDate } },
                create: {
                  tenantId: actor.tenantId,
                  calendarId: calendar.id,
                  exceptionDate,
                  name: 'Migrado desde calendario V1',
                  isWorking: false,
                  workingMinutes: 0,
                },
                update: {},
              });
            }
          }

          let profileState: BackfillState = currentProfile ? 'existing' : 'planned';
          if (!currentProfile && !dryRun) {
            await tx.projectScheduleProfile.create({
              data: {
                tenantId: actor.tenantId,
                projectObjectId: project.id,
                calendarId: calendar?.id ?? null,
                schedulingMode: 'AUTO',
                progressMethod: 'DURATION',
                timezone: calendar?.timezone ?? 'UTC',
                minutesPerDay,
                minutesPerWeek: minutesPerDay * Math.max(
                  1,
                  legacy.mode === 'CALENDAR_DAYS_V1' ? 7 : legacy.workingWeekdays.length,
                ),
                plannedStart: project.startDate,
                targetFinish: project.dueDate,
              },
            });
            profileState = 'created';
          } else if (currentProfile && calendar && currentProfile.calendarId !== calendar.id) {
            if (dryRun) {
              profileState = 'planned';
            } else {
              await tx.projectScheduleProfile.update({
                where: { id: currentProfile.id },
                data: { calendarId: calendar.id },
              });
              profileState = 'updated';
            }
          }

          const candidates = await tx.nexusObject.findMany({
            where: {
              tenantId: actor.tenantId,
              workspaceId: project.workspaceId,
              deletedAt: null,
              objectTypeKey: { in: ['TASK', 'DELIVERABLE', 'MILESTONE'] },
            },
            select: {
              id: true,
              objectTypeKey: true,
              startDate: true,
              dueDate: true,
              progress: true,
              metadata: true,
            },
          });
          const workItems = candidates.filter((object) => projectIdFromMetadata(object.metadata) === project.id);
          const workItemIds = workItems.map((object) => object.id);
          const existingSchedules = workItemIds.length === 0
            ? []
            : await tx.workItemSchedule.findMany({
                where: { tenantId: actor.tenantId, objectId: { in: workItemIds } },
                select: { objectId: true },
              });
          const existingScheduleIds = new Set(existingSchedules.map((row) => row.objectId));

          let workItemsPlanned = 0;
          let workItemsCreated = 0;
          let workItemsSkippedUnscheduled = 0;
          for (let index = 0; index < workItems.length; index += 1) {
            const object = workItems[index]!;
            if (existingScheduleIds.has(object.id)) continue;
            const durationMinutes = durationMinutesFromLegacyFields(
              {
                startDate: object.startDate,
                dueDate: object.dueDate,
                objectTypeKey: object.objectTypeKey,
              },
              legacy,
              minutesPerDay,
            );
            if (durationMinutes === null) {
              workItemsSkippedUnscheduled += 1;
              continue;
            }
            workItemsPlanned += 1;
            if (dryRun) continue;

            const remainingDurationMinutes = Math.max(
              0,
              Math.min(
                durationMinutes,
                Math.round(durationMinutes * (1 - Math.max(0, Math.min(100, object.progress)) / 100)),
              ),
            );
            await tx.workItemSchedule.create({
              data: {
                tenantId: actor.tenantId,
                projectObjectId: project.id,
                objectId: object.id,
                outlineLevel: 0,
                sortOrder: index,
                schedulingMode: 'AUTO',
                durationMinutes,
                remainingDurationMinutes,
                constraintType: 'AS_SOON_AS_POSSIBLE',
              },
            });
            workItemsCreated += 1;
          }

          const legacyRelations = workItemIds.length === 0
            ? []
            : await tx.objectRelation.findMany({
                where: {
                  tenantId: actor.tenantId,
                  relationType: 'DEPENDS_ON',
                  sourceObjectId: { in: workItemIds },
                  targetObjectId: { in: workItemIds },
                },
                select: {
                  id: true,
                  sourceObjectId: true,
                  targetObjectId: true,
                  notes: true,
                  metadata: true,
                },
              });

          let dependenciesPlanned = 0;
          let dependenciesCreated = 0;
          let dependenciesSkippedExisting = 0;
          for (const relation of legacyRelations) {
            const predecessorId = relation.targetObjectId;
            const successorId = relation.sourceObjectId;
            const existing = await tx.scheduleDependencyV2.findFirst({
              where: {
                tenantId: actor.tenantId,
                projectObjectId: project.id,
                predecessorObjectId: predecessorId,
                successorObjectId: successorId,
              },
              select: { id: true },
            });
            if (existing) {
              dependenciesSkippedExisting += 1;
              continue;
            }
            dependenciesPlanned += 1;
            if (dryRun) continue;

            const metadata = dependencyMetadata(relation.metadata);
            await tx.scheduleDependencyV2.create({
              data: {
                tenantId: actor.tenantId,
                projectObjectId: project.id,
                predecessorObjectId: predecessorId,
                successorObjectId: successorId,
                dependencyType: metadata.type,
                lagMinutes: metadata.lagDays * minutesPerDay,
                notes: relation.notes,
                legacyRelationId: relation.id,
              },
            });
            dependenciesCreated += 1;
          }

          if (!dryRun) {
            await Promise.all([
              tx.domainEvent.create({
                data: {
                  tenantId: actor.tenantId,
                  aggregateId: project.id,
                  eventType: 'bridata.project_engine_v2.backfilled',
                  payload: {
                    projectId: project.id,
                    workItemsCreated,
                    dependenciesCreated,
                    actorId: actor.userId,
                  },
                },
              }),
              tx.auditLog.create({
                data: {
                  tenantId: actor.tenantId,
                  userId: actor.userId,
                  action: 'PROJECT_ENGINE_V2_BACKFILLED',
                  resource: 'NEXUS_OBJECT',
                  resourceId: project.id,
                  correlationId: request.id,
                  ipAddress: request.ip,
                  details: {
                    workItemsCreated,
                    dependenciesCreated,
                    calendarState,
                    profileState,
                  },
                },
              }),
            ]);
          }

          summaries.push({
            projectId: project.id,
            projectTitle: project.title,
            calendar: calendarState,
            profile: profileState,
            workItemsPlanned,
            workItemsCreated,
            workItemsSkippedExisting: existingSchedules.length,
            workItemsSkippedUnscheduled,
            dependenciesPlanned,
            dependenciesCreated,
            dependenciesSkippedExisting,
          });
        }

        return {
          kind: 'ok' as const,
          payload: {
            tenantId: actor.tenantId,
            dryRun,
            requestedProjectId: projectId ?? null,
            projectCount: summaries.length,
            projects: summaries,
          },
        };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'project_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'schedule_management_denied' });
      return result.payload;
    },
  );
}
