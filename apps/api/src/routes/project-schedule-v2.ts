import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canAccessWorkspace, canManageWorkspace } from '../authorization.js';
import {
  durationMinutesFromLegacyFields,
  validateProjectScheduleProfileV2,
  validateWorkItemScheduleV2,
  ProjectScheduleV2ValidationError,
} from '../domain/project-schedule-v2.js';
import { calendarFromMetadata } from '../domain/work-calendar.js';
import { withTenant } from '../tenant-transaction.js';

const projectParamsSchema = z.object({ projectId: z.string().uuid() });
const workItemParamsSchema = z.object({ id: z.string().uuid() });
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schedulingModeSchema = z.enum(['AUTO', 'MANUAL']);
const progressMethodSchema = z.enum(['DURATION', 'PHYSICAL']);
const constraintTypeSchema = z.enum([
  'AS_SOON_AS_POSSIBLE',
  'AS_LATE_AS_POSSIBLE',
  'MUST_START_ON',
  'MUST_FINISH_ON',
  'START_NO_EARLIER_THAN',
  'START_NO_LATER_THAN',
  'FINISH_NO_EARLIER_THAN',
  'FINISH_NO_LATER_THAN',
]);
const dependencyTypeSchema = z.enum(['FS', 'SS', 'FF', 'SF']);

const projectProfileBodySchema = z.object({
  calendarId: z.string().uuid().nullable().optional(),
  schedulingMode: schedulingModeSchema.optional(),
  progressMethod: progressMethodSchema.optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  minutesPerDay: z.number().int().min(1).max(1440).optional(),
  minutesPerWeek: z.number().int().min(1).max(10080).optional(),
  statusDate: dateOnlySchema.nullable().optional(),
  plannedStart: dateOnlySchema.nullable().optional(),
  targetFinish: dateOnlySchema.nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one schedule profile field is required.',
});

const workItemScheduleBodySchema = z.object({
  parentWorkItemId: z.string().uuid().nullable().optional(),
  wbsCode: z.string().trim().max(100).nullable().optional(),
  outlineLevel: z.number().int().min(0).max(100).optional(),
  sortOrder: z.number().int().min(0).max(10_000_000).optional(),
  schedulingMode: schedulingModeSchema.optional(),
  durationMinutes: z.number().int().min(0).max(100_000_000).optional(),
  remainingDurationMinutes: z.number().int().min(0).max(100_000_000).optional(),
  constraintType: constraintTypeSchema.optional(),
  constraintDate: dateOnlySchema.nullable().optional(),
  actualStart: dateOnlySchema.nullable().optional(),
  actualFinish: dateOnlySchema.nullable().optional(),
  physicalPercentComplete: z.number().min(0).max(100).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one work item schedule field is required.',
});

function jsonRecord(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, Prisma.JsonValue>;
}

function projectIdFromMetadata(value: Prisma.JsonValue | null): string | null {
  const metadata = jsonRecord(value);
  return typeof metadata.projectId === 'string' ? metadata.projectId : null;
}

function dateOnlyUtc(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  return new Date(`${value}T00:00:00.000Z`);
}

function serializedDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function numberFromJson(value: Prisma.JsonValue | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringFromJson(value: Prisma.JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

async function requireProject(
  tx: Prisma.TransactionClient,
  tenantId: string,
  projectId: string,
) {
  return tx.nexusObject.findFirst({
    where: {
      id: projectId,
      tenantId,
      objectTypeKey: 'PROJECT',
      deletedAt: null,
    },
    select: {
      id: true,
      workspaceId: true,
      title: true,
      metadata: true,
      startDate: true,
      dueDate: true,
    },
  });
}

async function wouldCreateWbsCycle(
  tx: Prisma.TransactionClient,
  tenantId: string,
  objectId: string,
  proposedParentId: string | null,
): Promise<boolean> {
  if (!proposedParentId) return false;
  if (proposedParentId === objectId) return true;

  const visited = new Set<string>();
  let cursor: string | null = proposedParentId;

  while (cursor) {
    if (cursor === objectId) return true;
    if (visited.has(cursor)) return true;
    visited.add(cursor);

    const row = await tx.workItemSchedule.findFirst({
      where: { tenantId, objectId: cursor },
      select: { parentWorkItemId: true },
    });
    cursor = row?.parentWorkItemId ?? null;
  }

  return false;
}

export async function projectScheduleV2Routes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/projects/:projectId/schedule-model',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = projectParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'validation_error' });

      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const project = await requireProject(tx, actor.tenantId, params.data.projectId);
        if (!project) return { kind: 'not_found' as const };
        if (!(await canAccessWorkspace(tx, actor, project.workspaceId))) {
          return { kind: 'forbidden' as const };
        }

        const [profile, candidateObjects] = await Promise.all([
          tx.projectScheduleProfile.findUnique({
            where: { projectObjectId: project.id },
            include: {
              calendar: {
                include: { exceptions: { orderBy: { exceptionDate: 'asc' } } },
              },
            },
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
              progress: true,
              startDate: true,
              dueDate: true,
              metadata: true,
            },
          }),
        ]);

        const projectObjects = candidateObjects.filter(
          (object) => projectIdFromMetadata(object.metadata) === project.id,
        );
        const objectIds = projectObjects.map((object) => object.id);

        const [typedSchedules, typedDependencies, legacyRelations] = await Promise.all([
          tx.workItemSchedule.findMany({
            where: { tenantId: actor.tenantId, projectObjectId: project.id },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          }),
          tx.scheduleDependencyV2.findMany({
            where: { tenantId: actor.tenantId, projectObjectId: project.id },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          }),
          objectIds.length === 0
            ? Promise.resolve([])
            : tx.objectRelation.findMany({
                where: {
                  tenantId: actor.tenantId,
                  relationType: 'DEPENDS_ON',
                  sourceObjectId: { in: objectIds },
                  targetObjectId: { in: objectIds },
                },
                select: {
                  id: true,
                  sourceObjectId: true,
                  targetObjectId: true,
                  metadata: true,
                  notes: true,
                  createdAt: true,
                },
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              }),
        ]);

        const projectMetadata = jsonRecord(project.metadata);
        const legacyCalendar = calendarFromMetadata(project.metadata);
        const minutesPerDay = profile?.minutesPerDay ?? numberFromJson(projectMetadata.scheduleMinutesPerDay, 480);
        const minutesPerWeek = profile?.minutesPerWeek ?? numberFromJson(projectMetadata.scheduleMinutesPerWeek, minutesPerDay * 5);
        const scheduleByObjectId = new Map(typedSchedules.map((schedule) => [schedule.objectId, schedule]));

        const workItems = projectObjects.map((object, index) => {
          const schedule = scheduleByObjectId.get(object.id);
          const objectMetadata = jsonRecord(object.metadata);
          const legacyDuration = durationMinutesFromLegacyFields(
            {
              objectTypeKey: object.objectTypeKey,
              startDate: object.startDate,
              dueDate: object.dueDate,
            },
            legacyCalendar,
            minutesPerDay,
          ) ?? 0;
          const remainingFallback = Math.max(
            0,
            Math.round(legacyDuration * (100 - Math.min(100, Math.max(0, object.progress))) / 100),
          );

          return {
            objectId: object.id,
            objectTypeKey: object.objectTypeKey,
            title: object.title,
            source: schedule ? 'V2' as const : 'V1_FALLBACK' as const,
            parentWorkItemId: schedule?.parentWorkItemId ?? stringFromJson(objectMetadata.parentWorkItemId) ?? null,
            wbsCode: schedule?.wbsCode ?? stringFromJson(objectMetadata.wbsCode) ?? null,
            outlineLevel: schedule?.outlineLevel ?? numberFromJson(objectMetadata.outlineLevel, 0),
            sortOrder: schedule?.sortOrder ?? numberFromJson(objectMetadata.sortOrder, index),
            schedulingMode: schedule?.schedulingMode ?? 'AUTO',
            durationMinutes: schedule?.durationMinutes ?? legacyDuration,
            remainingDurationMinutes: schedule?.remainingDurationMinutes ?? remainingFallback,
            constraintType: schedule?.constraintType ?? 'AS_SOON_AS_POSSIBLE',
            constraintDate: serializedDate(schedule?.constraintDate),
            actualStart: serializedDate(schedule?.actualStart),
            actualFinish: serializedDate(schedule?.actualFinish),
            physicalPercentComplete: schedule?.physicalPercentComplete === null || schedule?.physicalPercentComplete === undefined
              ? null
              : Number(schedule.physicalPercentComplete),
            plannedStart: serializedDate(object.startDate),
            plannedFinish: serializedDate(object.dueDate),
            progress: object.progress,
          };
        });

        const typedByLegacyId = new Map(
          typedDependencies
            .filter((dependency) => dependency.legacyRelationId)
            .map((dependency) => [dependency.legacyRelationId!, dependency]),
        );
        const legacyEdgeKeys = new Set<string>();
        const dependencies = legacyRelations.map((relation) => {
          const metadata = jsonRecord(relation.metadata);
          const parsedType = dependencyTypeSchema.safeParse(metadata.dependencyType);
          const lagDays = typeof metadata.lagDays === 'number' && Number.isFinite(metadata.lagDays)
            ? Math.trunc(metadata.lagDays)
            : 0;
          const typed = typedByLegacyId.get(relation.id);
          legacyEdgeKeys.add(`${relation.targetObjectId}:${relation.sourceObjectId}`);

          return {
            id: typed?.id ?? relation.id,
            legacyRelationId: relation.id,
            predecessorObjectId: relation.targetObjectId,
            successorObjectId: relation.sourceObjectId,
            dependencyType: typed?.dependencyType ?? (parsedType.success ? parsedType.data : 'FS'),
            lagMinutes: typed?.lagMinutes ?? lagDays * minutesPerDay,
            notes: typed?.notes ?? relation.notes,
            source: typed ? 'V2_SYNCED' as const : 'V1_FALLBACK' as const,
          };
        });

        for (const typed of typedDependencies) {
          const edgeKey = `${typed.predecessorObjectId}:${typed.successorObjectId}`;
          if (legacyEdgeKeys.has(edgeKey)) continue;
          dependencies.push({
            id: typed.id,
            legacyRelationId: typed.legacyRelationId,
            predecessorObjectId: typed.predecessorObjectId,
            successorObjectId: typed.successorObjectId,
            dependencyType: typed.dependencyType,
            lagMinutes: typed.lagMinutes,
            notes: typed.notes,
            source: 'V2' as const,
          });
        }

        return {
          kind: 'ok' as const,
          model: {
            engineVersion: 2,
            project: {
              id: project.id,
              title: project.title,
              workspaceId: project.workspaceId,
            },
            profile: {
              source: profile ? 'V2' as const : 'V1_FALLBACK' as const,
              calendarId: profile?.calendarId ?? null,
              schedulingMode: profile?.schedulingMode ?? 'AUTO',
              progressMethod: profile?.progressMethod ?? 'DURATION',
              timezone: profile?.timezone ?? stringFromJson(projectMetadata.scheduleTimezone) ?? 'UTC',
              minutesPerDay,
              minutesPerWeek,
              statusDate: serializedDate(profile?.statusDate),
              plannedStart: serializedDate(profile?.plannedStart ?? project.startDate),
              targetFinish: serializedDate(profile?.targetFinish ?? project.dueDate),
              legacyCalendarMode: legacyCalendar.mode,
              workingWeekdays: profile?.calendar?.workingWeekdays ?? legacyCalendar.workingWeekdays,
              exceptions: profile?.calendar?.exceptions.map((exception) => ({
                date: serializedDate(exception.exceptionDate),
                name: exception.name,
                isWorking: exception.isWorking,
                workingMinutes: exception.workingMinutes,
              })) ?? legacyCalendar.holidays.map((date) => ({
                date,
                name: null,
                isWorking: false,
                workingMinutes: null,
              })),
            },
            workItems,
            dependencies,
            migration: {
              totalWorkItems: workItems.length,
              typedWorkItems: workItems.filter((item) => item.source === 'V2').length,
              fallbackWorkItems: workItems.filter((item) => item.source === 'V1_FALLBACK').length,
              typedDependencies: dependencies.filter((item) => item.source !== 'V1_FALLBACK').length,
              fallbackDependencies: dependencies.filter((item) => item.source === 'V1_FALLBACK').length,
            },
          },
        };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'project_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
      return result.model;
    },
  );

  app.patch(
    '/api/v1/projects/:projectId/schedule-profile',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = projectParamsSchema.safeParse(request.params);
      const body = projectProfileBodySchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: 'validation_error' });
      }

      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const project = await requireProject(tx, actor.tenantId, params.data.projectId);
        if (!project) return { kind: 'not_found' as const };
        if (!(await canManageWorkspace(tx, actor, project.workspaceId))) {
          return { kind: 'forbidden' as const };
        }

        if (body.data.calendarId) {
          const calendar = await tx.workCalendar.findFirst({
            where: {
              id: body.data.calendarId,
              tenantId: actor.tenantId,
              workspaceId: project.workspaceId,
            },
            select: { id: true },
          });
          if (!calendar) return { kind: 'calendar_not_found' as const };
        }

        const existing = await tx.projectScheduleProfile.findUnique({
          where: { projectObjectId: project.id },
        });
        const projectMetadata = jsonRecord(project.metadata);
        const candidate = validateProjectScheduleProfileV2({
          projectObjectId: project.id,
          ...(body.data.calendarId !== undefined
            ? body.data.calendarId ? { calendarId: body.data.calendarId } : {}
            : existing?.calendarId ? { calendarId: existing.calendarId } : {}),
          schedulingMode: body.data.schedulingMode ?? existing?.schedulingMode ?? 'AUTO',
          progressMethod: body.data.progressMethod ?? existing?.progressMethod ?? 'DURATION',
          timezone: body.data.timezone ?? existing?.timezone ?? stringFromJson(projectMetadata.scheduleTimezone) ?? 'UTC',
          minutesPerDay: body.data.minutesPerDay ?? existing?.minutesPerDay ?? numberFromJson(projectMetadata.scheduleMinutesPerDay, 480),
          minutesPerWeek: body.data.minutesPerWeek ?? existing?.minutesPerWeek ?? numberFromJson(projectMetadata.scheduleMinutesPerWeek, 2400),
          ...(body.data.statusDate !== undefined
            ? dateOnlyUtc(body.data.statusDate) ? { statusDate: dateOnlyUtc(body.data.statusDate) } : {}
            : existing?.statusDate ? { statusDate: existing.statusDate } : {}),
          ...(body.data.plannedStart !== undefined
            ? dateOnlyUtc(body.data.plannedStart) ? { plannedStart: dateOnlyUtc(body.data.plannedStart) } : {}
            : existing?.plannedStart ? { plannedStart: existing.plannedStart } : project.startDate ? { plannedStart: project.startDate } : {}),
          ...(body.data.targetFinish !== undefined
            ? dateOnlyUtc(body.data.targetFinish) ? { targetFinish: dateOnlyUtc(body.data.targetFinish) } : {}
            : existing?.targetFinish ? { targetFinish: existing.targetFinish } : project.dueDate ? { targetFinish: project.dueDate } : {}),
        });

        const saved = await tx.projectScheduleProfile.upsert({
          where: { projectObjectId: project.id },
          update: {
            calendarId: body.data.calendarId !== undefined ? body.data.calendarId : existing?.calendarId,
            schedulingMode: candidate.schedulingMode,
            progressMethod: candidate.progressMethod,
            timezone: candidate.timezone,
            minutesPerDay: candidate.minutesPerDay,
            minutesPerWeek: candidate.minutesPerWeek,
            statusDate: body.data.statusDate !== undefined ? dateOnlyUtc(body.data.statusDate) ?? null : existing?.statusDate,
            plannedStart: body.data.plannedStart !== undefined ? dateOnlyUtc(body.data.plannedStart) ?? null : candidate.plannedStart,
            targetFinish: body.data.targetFinish !== undefined ? dateOnlyUtc(body.data.targetFinish) ?? null : candidate.targetFinish,
          },
          create: {
            tenantId: actor.tenantId,
            projectObjectId: project.id,
            calendarId: body.data.calendarId ?? null,
            schedulingMode: candidate.schedulingMode,
            progressMethod: candidate.progressMethod,
            timezone: candidate.timezone,
            minutesPerDay: candidate.minutesPerDay,
            minutesPerWeek: candidate.minutesPerWeek,
            statusDate: body.data.statusDate !== undefined ? dateOnlyUtc(body.data.statusDate) ?? null : candidate.statusDate,
            plannedStart: body.data.plannedStart !== undefined ? dateOnlyUtc(body.data.plannedStart) ?? null : candidate.plannedStart,
            targetFinish: body.data.targetFinish !== undefined ? dateOnlyUtc(body.data.targetFinish) ?? null : candidate.targetFinish,
          },
        });

        await Promise.all([
          tx.domainEvent.create({
            data: {
              tenantId: actor.tenantId,
              aggregateId: project.id,
              eventType: 'bridata.project.schedule-profile.updated',
              payload: {
                projectId: project.id,
                scheduleProfileId: saved.id,
                actorId: actor.userId,
              },
            },
          }),
          tx.auditLog.create({
            data: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              action: 'PROJECT_SCHEDULE_PROFILE_UPDATED',
              resource: 'PROJECT_SCHEDULE_PROFILE',
              resourceId: saved.id,
              correlationId: request.id,
              ipAddress: request.ip,
              details: {
                projectId: project.id,
                schedulingMode: saved.schedulingMode,
                progressMethod: saved.progressMethod,
                minutesPerDay: saved.minutesPerDay,
                minutesPerWeek: saved.minutesPerWeek,
              },
            },
          }),
        ]);

        return { kind: 'saved' as const, saved };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'project_not_found' });
      if (result.kind === 'calendar_not_found') return reply.code(404).send({ error: 'calendar_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'schedule_management_denied' });
      return {
        id: result.saved.id,
        projectObjectId: result.saved.projectObjectId,
        calendarId: result.saved.calendarId,
        schedulingMode: result.saved.schedulingMode,
        progressMethod: result.saved.progressMethod,
        timezone: result.saved.timezone,
        minutesPerDay: result.saved.minutesPerDay,
        minutesPerWeek: result.saved.minutesPerWeek,
        statusDate: serializedDate(result.saved.statusDate),
        plannedStart: serializedDate(result.saved.plannedStart),
        targetFinish: serializedDate(result.saved.targetFinish),
      };
    },
  );

  app.patch(
    '/api/v1/work-items/:id/schedule',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = workItemParamsSchema.safeParse(request.params);
      const body = workItemScheduleBodySchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: 'validation_error' });
      }

      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const workItem = await tx.nexusObject.findFirst({
          where: {
            id: params.data.id,
            tenantId: actor.tenantId,
            deletedAt: null,
            objectTypeKey: { in: ['TASK', 'DELIVERABLE', 'MILESTONE'] },
          },
          select: {
            id: true,
            workspaceId: true,
            objectTypeKey: true,
            progress: true,
            startDate: true,
            dueDate: true,
            metadata: true,
          },
        });
        if (!workItem) return { kind: 'not_found' as const };

        const projectId = projectIdFromMetadata(workItem.metadata);
        if (!projectId) return { kind: 'project_missing' as const };
        const project = await requireProject(tx, actor.tenantId, projectId);
        if (!project || project.workspaceId !== workItem.workspaceId) {
          return { kind: 'project_missing' as const };
        }
        if (!(await canManageWorkspace(tx, actor, project.workspaceId))) {
          return { kind: 'forbidden' as const };
        }

        const [existing, profile] = await Promise.all([
          tx.workItemSchedule.findUnique({ where: { objectId: workItem.id } }),
          tx.projectScheduleProfile.findUnique({ where: { projectObjectId: project.id } }),
        ]);
        const legacyCalendar = calendarFromMetadata(project.metadata);
        const minutesPerDay = profile?.minutesPerDay ?? 480;
        const legacyDuration = durationMinutesFromLegacyFields(
          {
            objectTypeKey: workItem.objectTypeKey,
            startDate: workItem.startDate,
            dueDate: workItem.dueDate,
          },
          legacyCalendar,
          minutesPerDay,
        ) ?? 0;
        const durationMinutes = body.data.durationMinutes ?? existing?.durationMinutes ?? legacyDuration;
        const remainingDurationMinutes = body.data.remainingDurationMinutes
          ?? existing?.remainingDurationMinutes
          ?? Math.max(0, Math.round(durationMinutes * (100 - Math.min(100, Math.max(0, workItem.progress))) / 100));

        const proposedParentId = body.data.parentWorkItemId !== undefined
          ? body.data.parentWorkItemId
          : existing?.parentWorkItemId ?? null;
        if (proposedParentId) {
          const parent = await tx.nexusObject.findFirst({
            where: {
              id: proposedParentId,
              tenantId: actor.tenantId,
              workspaceId: project.workspaceId,
              deletedAt: null,
              objectTypeKey: { in: ['TASK', 'DELIVERABLE', 'MILESTONE'] },
            },
            select: { id: true, metadata: true },
          });
          if (!parent || projectIdFromMetadata(parent.metadata) !== project.id) {
            return { kind: 'invalid_parent' as const };
          }
          if (await wouldCreateWbsCycle(tx, actor.tenantId, workItem.id, proposedParentId)) {
            return { kind: 'wbs_cycle' as const };
          }
        }

        const candidate = validateWorkItemScheduleV2({
          objectId: workItem.id,
          projectObjectId: project.id,
          ...(proposedParentId ? { parentWorkItemId: proposedParentId } : {}),
          ...(body.data.wbsCode !== undefined
            ? body.data.wbsCode ? { wbsCode: body.data.wbsCode } : {}
            : existing?.wbsCode ? { wbsCode: existing.wbsCode } : {}),
          outlineLevel: body.data.outlineLevel ?? existing?.outlineLevel ?? 0,
          sortOrder: body.data.sortOrder ?? existing?.sortOrder ?? 0,
          schedulingMode: body.data.schedulingMode ?? existing?.schedulingMode ?? 'AUTO',
          durationMinutes,
          remainingDurationMinutes,
          constraintType: body.data.constraintType ?? existing?.constraintType ?? 'AS_SOON_AS_POSSIBLE',
          ...(body.data.constraintDate !== undefined
            ? dateOnlyUtc(body.data.constraintDate) ? { constraintDate: dateOnlyUtc(body.data.constraintDate) } : {}
            : existing?.constraintDate ? { constraintDate: existing.constraintDate } : {}),
          ...(body.data.actualStart !== undefined
            ? dateOnlyUtc(body.data.actualStart) ? { actualStart: dateOnlyUtc(body.data.actualStart) } : {}
            : existing?.actualStart ? { actualStart: existing.actualStart } : {}),
          ...(body.data.actualFinish !== undefined
            ? dateOnlyUtc(body.data.actualFinish) ? { actualFinish: dateOnlyUtc(body.data.actualFinish) } : {}
            : existing?.actualFinish ? { actualFinish: existing.actualFinish } : {}),
          ...(body.data.physicalPercentComplete !== undefined
            ? body.data.physicalPercentComplete !== null ? { physicalPercentComplete: body.data.physicalPercentComplete } : {}
            : existing?.physicalPercentComplete !== null && existing?.physicalPercentComplete !== undefined
              ? { physicalPercentComplete: Number(existing.physicalPercentComplete) }
              : {}),
        });

        const saved = await tx.workItemSchedule.upsert({
          where: { objectId: workItem.id },
          update: {
            parentWorkItemId: body.data.parentWorkItemId !== undefined ? body.data.parentWorkItemId : existing?.parentWorkItemId,
            wbsCode: body.data.wbsCode !== undefined ? body.data.wbsCode : existing?.wbsCode,
            outlineLevel: candidate.outlineLevel,
            sortOrder: candidate.sortOrder,
            schedulingMode: candidate.schedulingMode,
            durationMinutes: candidate.durationMinutes,
            remainingDurationMinutes: candidate.remainingDurationMinutes,
            constraintType: candidate.constraintType,
            constraintDate: body.data.constraintDate !== undefined ? dateOnlyUtc(body.data.constraintDate) ?? null : existing?.constraintDate,
            actualStart: body.data.actualStart !== undefined ? dateOnlyUtc(body.data.actualStart) ?? null : existing?.actualStart,
            actualFinish: body.data.actualFinish !== undefined ? dateOnlyUtc(body.data.actualFinish) ?? null : existing?.actualFinish,
            physicalPercentComplete: body.data.physicalPercentComplete !== undefined
              ? body.data.physicalPercentComplete
              : existing?.physicalPercentComplete,
          },
          create: {
            tenantId: actor.tenantId,
            projectObjectId: project.id,
            objectId: workItem.id,
            parentWorkItemId: body.data.parentWorkItemId ?? null,
            wbsCode: body.data.wbsCode ?? null,
            outlineLevel: candidate.outlineLevel,
            sortOrder: candidate.sortOrder,
            schedulingMode: candidate.schedulingMode,
            durationMinutes: candidate.durationMinutes,
            remainingDurationMinutes: candidate.remainingDurationMinutes,
            constraintType: candidate.constraintType,
            constraintDate: body.data.constraintDate !== undefined ? dateOnlyUtc(body.data.constraintDate) ?? null : candidate.constraintDate,
            actualStart: body.data.actualStart !== undefined ? dateOnlyUtc(body.data.actualStart) ?? null : candidate.actualStart,
            actualFinish: body.data.actualFinish !== undefined ? dateOnlyUtc(body.data.actualFinish) ?? null : candidate.actualFinish,
            physicalPercentComplete: body.data.physicalPercentComplete ?? candidate.physicalPercentComplete,
          },
        });

        await Promise.all([
          tx.domainEvent.create({
            data: {
              tenantId: actor.tenantId,
              aggregateId: workItem.id,
              eventType: 'bridata.work-item.schedule.updated',
              payload: {
                projectId: project.id,
                workItemId: workItem.id,
                durationMinutes: saved.durationMinutes,
                remainingDurationMinutes: saved.remainingDurationMinutes,
                constraintType: saved.constraintType,
                actorId: actor.userId,
              },
            },
          }),
          tx.auditLog.create({
            data: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              action: 'WORK_ITEM_SCHEDULE_UPDATED',
              resource: 'WORK_ITEM_SCHEDULE',
              resourceId: saved.id,
              correlationId: request.id,
              ipAddress: request.ip,
              details: {
                projectId: project.id,
                workItemId: workItem.id,
                parentWorkItemId: saved.parentWorkItemId,
                wbsCode: saved.wbsCode,
                durationMinutes: saved.durationMinutes,
                remainingDurationMinutes: saved.remainingDurationMinutes,
              },
            },
          }),
        ]);

        return { kind: 'saved' as const, saved };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'work_item_not_found' });
      if (result.kind === 'project_missing') return reply.code(409).send({ error: 'work_item_project_missing' });
      if (result.kind === 'invalid_parent') return reply.code(400).send({ error: 'invalid_wbs_parent' });
      if (result.kind === 'wbs_cycle') return reply.code(409).send({ error: 'wbs_cycle' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'schedule_management_denied' });

      return {
        id: result.saved.id,
        objectId: result.saved.objectId,
        projectObjectId: result.saved.projectObjectId,
        parentWorkItemId: result.saved.parentWorkItemId,
        wbsCode: result.saved.wbsCode,
        outlineLevel: result.saved.outlineLevel,
        sortOrder: result.saved.sortOrder,
        schedulingMode: result.saved.schedulingMode,
        durationMinutes: result.saved.durationMinutes,
        remainingDurationMinutes: result.saved.remainingDurationMinutes,
        constraintType: result.saved.constraintType,
        constraintDate: serializedDate(result.saved.constraintDate),
        actualStart: serializedDate(result.saved.actualStart),
        actualFinish: serializedDate(result.saved.actualFinish),
        physicalPercentComplete: result.saved.physicalPercentComplete === null
          ? null
          : Number(result.saved.physicalPercentComplete),
      };
    },
  );
}

export function projectScheduleV2ErrorHandler(error: unknown): never {
  if (error instanceof ProjectScheduleV2ValidationError) throw error;
  throw error;
}
