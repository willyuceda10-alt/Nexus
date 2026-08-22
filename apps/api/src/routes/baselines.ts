import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor, type ActorContext } from '../auth.js';
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

function hasBaseline(value: Prisma.JsonValue | null): boolean {
  const metadata = asRecord(value);
  return typeof metadata.baselineStartDate === 'string' || typeof metadata.baselineEndDate === 'string';
}

function dateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function isTenantAdmin(actor: ActorContext): boolean {
  return actor.role === 'OWNER' || actor.role === 'TENANT_ADMIN';
}

async function canManageWorkspace(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  workspaceId: string,
): Promise<boolean> {
  if (isTenantAdmin(actor)) return true;

  const membership = await tx.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId: actor.userId,
      },
    },
    select: { tenantId: true, role: true },
  });

  return Boolean(
    membership?.tenantId === actor.tenantId &&
      ['OWNER', 'ADMIN', 'MANAGER'].includes(membership.role),
  );
}

export async function baselineRoutes(app: FastifyInstance): Promise<void> {
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
            startDate: true,
            dueDate: true,
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
            metadata: true,
            version: true,
          },
        });

        const projectChildren = candidates.filter(
          (object) => projectIdFromMetadata(object.metadata) === project.id,
        );
        const objects = [project, ...projectChildren];
        const existingBaselineCount = objects.filter((object) => hasBaseline(object.metadata)).length;

        if (existingBaselineCount > 0 && !body.data.overwrite) {
          return {
            kind: 'baseline_exists' as const,
            existingBaselineCount,
          };
        }

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

        const projectMetadata = asRecord(project.metadata);
        const previousBaselineVersion = typeof projectMetadata.baselineVersion === 'number'
          ? Math.max(0, Math.trunc(projectMetadata.baselineVersion))
          : 0;
        const baselineVersion = previousBaselineVersion + 1;

        // The project was updated above. Persist baseline version separately so it
        // stays a project-level snapshot marker without changing child metadata.
        const refreshedProject = await tx.nexusObject.findUniqueOrThrow({
          where: { id: project.id },
          select: { metadata: true },
        });
        const refreshedMetadata = asRecord(refreshedProject.metadata);
        refreshedMetadata.baselineVersion = baselineVersion;
        await tx.nexusObject.update({
          where: { id: project.id },
          data: { metadata: refreshedMetadata as Prisma.InputJsonValue },
        });

        await Promise.all([
          tx.domainEvent.create({
            data: {
              tenantId: actor.tenantId,
              aggregateId: project.id,
              eventType: 'bridata.project.baseline.saved',
              payload: {
                projectId: project.id,
                workspaceId: project.workspaceId,
                baselineVersion,
                capturedAt: capturedAt.toISOString(),
                updatedCount,
                scheduledCount,
                skippedUnscheduledCount,
                overwritten: existingBaselineCount > 0,
                actorId: actor.userId,
              },
            },
          }),
          tx.auditLog.create({
            data: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              action: existingBaselineCount > 0 ? 'PROJECT_BASELINE_REPLACED' : 'PROJECT_BASELINE_SAVED',
              resource: 'NEXUS_OBJECT',
              resourceId: project.id,
              correlationId: request.id,
              ipAddress: request.ip,
              details: {
                workspaceId: project.workspaceId,
                baselineVersion,
                capturedAt: capturedAt.toISOString(),
                updatedCount,
                scheduledCount,
                skippedUnscheduledCount,
              },
            },
          }),
        ]);

        return {
          kind: 'saved' as const,
          summary: {
            projectId: project.id,
            workspaceId: project.workspaceId,
            baselineVersion,
            capturedAt: capturedAt.toISOString(),
            updatedCount,
            scheduledCount,
            skippedUnscheduledCount,
            overwritten: existingBaselineCount > 0,
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
          message: 'This project already has a baseline. Set overwrite=true to replace it.',
          details: { existingBaselineCount: result.existingBaselineCount },
        });
      }

      return reply.code(201).send(result.summary);
    },
  );
}
