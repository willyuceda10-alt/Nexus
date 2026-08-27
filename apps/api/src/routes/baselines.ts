import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canAccessWorkspace, canManageWorkspace } from '../authorization.js';
import { durationMinutesFromLegacyFields } from '../domain/project-schedule-v2.js';
import { calendarFromMetadata } from '../domain/work-calendar.js';
import { withTenant } from '../tenant-transaction.js';

const paramsSchema = z.object({
  projectId: z.string().uuid(),
});

const bodySchema = z.object({
  overwrite: z.boolean().default(false),
});

function asRecord(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...(value as Record<string, Prisma.JsonValue>) };
}

function projectIdFromMetadata(value: Prisma.JsonValue | null): string | null {
  const metadata = asRecord(value);
  return typeof metadata.projectId === 'string' ? metadata.projectId : null;
}

function hasLegacyBaseline(value: Prisma.JsonValue | null): boolean {
  const metadata = asRecord(value);
  return (
    typeof metadata.baselineCapturedAt === 'string' ||
    typeof metadata.baselineStartDate === 'string' ||
    typeof metadata.baselineEndDate === 'string'
  );
}

function dateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function stringMetadata(value: Prisma.JsonValue | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export async function baselineRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/projects/:projectId/baselines',
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
          select: { id: true, workspaceId: true },
        });
        if (!project) return { kind: 'not_found' as const };
        if (!(await canAccessWorkspace(tx, actor, project.workspaceId))) {
          return { kind: 'forbidden' as const };
        }

        const baselines = await tx.projectBaseline.findMany({
          where: { tenantId: actor.tenantId, projectObjectId: project.id },
          include: {
            _count: { select: { items: true } },
            capturedBy: { select: { id: true, fullName: true, email: true } },
          },
          orderBy: [{ version: 'desc' }, { capturedAt: 'desc' }],
        });

        return {
          kind: 'ok' as const,
          baselines: baselines.map((baseline) => ({
            id: baseline.id,
            version: baseline.version,
            name: baseline.name,
            capturedAt: baseline.capturedAt.toISOString(),
            capturedBy: baseline.capturedBy,
            itemCount: baseline._count.items,
          })),
        };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'project_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
      return { items: result.baselines };
    },
  );

  app.post(
    '/api/v1/projects/:projectId/baseline',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      const body = bodySchema.safeParse(request.body ?? {});
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: 'validation_error' });
      }

      const actor = request.actor!;
      const capturedAt = new Date();

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
            objectTypeKey: true,
            startDate: true,
            dueDate: true,
            progress: true,
            metadata: true,
            version: true,
          },
        });

        if (!project) return { kind: 'not_found' as const };
        if (!(await canManageWorkspace(tx, actor, project.workspaceId))) {
          return { kind: 'forbidden' as const };
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
            version: true,
          },
        });

        const projectChildren = candidates.filter(
          (object) => projectIdFromMetadata(object.metadata) === project.id,
        );
        const objects = [project, ...projectChildren];
        const legacyBaselineCount = objects.filter((object) => hasLegacyBaseline(object.metadata)).length;
        const latestTypedBaseline = await tx.projectBaseline.findFirst({
          where: { tenantId: actor.tenantId, projectObjectId: project.id },
          select: { id: true, version: true },
          orderBy: { version: 'desc' },
        });

        if ((legacyBaselineCount > 0 || latestTypedBaseline) && !body.data.overwrite) {
          return {
            kind: 'baseline_exists' as const,
            existingBaselineCount: Math.max(legacyBaselineCount, latestTypedBaseline ? 1 : 0),
            latestVersion: latestTypedBaseline?.version ?? null,
          };
        }

        const projectMetadata = asRecord(project.metadata);
        const previousLegacyVersion = typeof projectMetadata.baselineVersion === 'number'
          ? Math.max(0, Math.trunc(projectMetadata.baselineVersion))
          : 0;
        const baselineVersion = Math.max(previousLegacyVersion, latestTypedBaseline?.version ?? 0) + 1;

        const [profile, typedSchedules] = await Promise.all([
          tx.projectScheduleProfile.findUnique({
            where: { projectObjectId: project.id },
            select: { minutesPerDay: true },
          }),
          tx.workItemSchedule.findMany({
            where: { tenantId: actor.tenantId, projectObjectId: project.id },
          }),
        ]);
        const typedScheduleByObjectId = new Map(typedSchedules.map((schedule) => [schedule.objectId, schedule]));
        const calendar = calendarFromMetadata(project.metadata);
        const minutesPerDay = profile?.minutesPerDay ?? 480;

        const baseline = await tx.projectBaseline.create({
          data: {
            tenantId: actor.tenantId,
            projectObjectId: project.id,
            version: baselineVersion,
            name: `Baseline ${baselineVersion}`,
            capturedByUserId: actor.userId,
            capturedAt,
          },
        });

        await tx.projectBaselineItem.createMany({
          data: objects.map((object) => {
            const typed = typedScheduleByObjectId.get(object.id);
            const metadata = asRecord(object.metadata);
            const durationMinutes = typed?.durationMinutes
              ?? durationMinutesFromLegacyFields(
                {
                  objectTypeKey: object.objectTypeKey,
                  startDate: object.startDate,
                  dueDate: object.dueDate,
                },
                calendar,
                minutesPerDay,
              )
              ?? 0;
            const remainingDurationMinutes = typed?.remainingDurationMinutes
              ?? Math.max(
                0,
                Math.round(durationMinutes * (100 - Math.min(100, Math.max(0, object.progress))) / 100),
              );

            return {
              tenantId: actor.tenantId,
              baselineId: baseline.id,
              workItemObjectId: object.id,
              wbsCode: typed?.wbsCode ?? stringMetadata(metadata.wbsCode),
              plannedStart: object.startDate,
              plannedFinish: object.dueDate,
              durationMinutes,
              remainingDurationMinutes,
              progress: Math.min(100, Math.max(0, object.progress)),
              physicalPercentComplete: typed?.physicalPercentComplete ?? null,
            };
          }),
        });

        // Preserve V1 metadata as a compatibility pointer to the latest snapshot.
        // Historical truth now lives in immutable project_baselines/items rows.
        let updatedCount = 0;
        let scheduledCount = 0;
        let skippedUnscheduledCount = 0;

        for (const object of objects) {
          const metadata = asRecord(object.metadata);
          delete metadata.baselineStartDate;
          delete metadata.baselineEndDate;
          metadata.baselineCapturedAt = capturedAt.toISOString();

          const baselineStartDate = dateOnly(object.startDate);
          const baselineEndDate = dateOnly(object.dueDate);
          if (baselineStartDate) metadata.baselineStartDate = baselineStartDate;
          if (baselineEndDate) metadata.baselineEndDate = baselineEndDate;

          if (baselineStartDate || baselineEndDate) scheduledCount += 1;
          else skippedUnscheduledCount += 1;

          await tx.nexusObject.update({
            where: { id: object.id },
            data: {
              metadata: metadata as Prisma.InputJsonValue,
              version: { increment: 1 },
            },
          });
          updatedCount += 1;
        }

        const refreshedProject = await tx.nexusObject.findUniqueOrThrow({
          where: { id: project.id },
          select: { metadata: true },
        });
        const refreshedMetadata = asRecord(refreshedProject.metadata);
        refreshedMetadata.baselineVersion = baselineVersion;
        refreshedMetadata.baselineId = baseline.id;
        await tx.nexusObject.update({
          where: { id: project.id },
          data: { metadata: refreshedMetadata as Prisma.InputJsonValue },
        });

        const hadPreviousBaseline = legacyBaselineCount > 0 || Boolean(latestTypedBaseline);
        await Promise.all([
          tx.domainEvent.create({
            data: {
              tenantId: actor.tenantId,
              aggregateId: project.id,
              eventType: 'bridata.project.baseline.saved',
              payload: {
                projectId: project.id,
                workspaceId: project.workspaceId,
                baselineId: baseline.id,
                baselineVersion,
                capturedAt: capturedAt.toISOString(),
                updatedCount,
                scheduledCount,
                skippedUnscheduledCount,
                previousBaselinePreserved: hadPreviousBaseline,
                actorId: actor.userId,
              },
            },
          }),
          tx.auditLog.create({
            data: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              action: hadPreviousBaseline
                ? 'PROJECT_BASELINE_VERSION_CREATED'
                : 'PROJECT_BASELINE_SAVED',
              resource: 'PROJECT_BASELINE',
              resourceId: baseline.id,
              correlationId: request.id,
              ipAddress: request.ip,
              details: {
                projectId: project.id,
                workspaceId: project.workspaceId,
                baselineVersion,
                capturedAt: capturedAt.toISOString(),
                updatedCount,
                scheduledCount,
                skippedUnscheduledCount,
                immutableHistory: true,
              },
            },
          }),
        ]);

        return {
          kind: 'saved' as const,
          summary: {
            projectId: project.id,
            workspaceId: project.workspaceId,
            baselineId: baseline.id,
            baselineVersion,
            capturedAt: capturedAt.toISOString(),
            updatedCount,
            scheduledCount,
            skippedUnscheduledCount,
            previousBaselinePreserved: hadPreviousBaseline,
            immutableHistory: true,
          },
        };
      });

      if (result.kind === 'not_found') {
        return reply.code(404).send({ error: 'project_not_found' });
      }
      if (result.kind === 'forbidden') {
        return reply.code(403).send({ error: 'baseline_permission_denied' });
      }
      if (result.kind === 'baseline_exists') {
        return reply.code(409).send({
          error: 'baseline_exists',
          message: 'This project already has a baseline. Set overwrite=true to capture a new immutable baseline version.',
          details: {
            existingBaselineCount: result.existingBaselineCount,
            latestVersion: result.latestVersion,
          },
        });
      }

      return reply.code(201).send(result.summary);
    },
  );
}
