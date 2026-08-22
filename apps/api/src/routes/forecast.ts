import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor, type ActorContext } from '../auth.js';
import { forecastTask, summarizeForecast } from '../domain/forecast.js';
import { calendarFromMetadata } from '../domain/work-calendar.js';
import { withTenant } from '../tenant-transaction.js';

const querySchema = z.object({
  projectId: z.string().uuid(),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

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

function projectIdFromMetadata(value: Prisma.JsonValue | null): string | null {
  const metadata = jsonRecord(value);
  return typeof metadata.projectId === 'string' ? metadata.projectId : null;
}

function utcDateOnly(value?: string): Date {
  if (value) return new Date(`${value}T00:00:00.000Z`);
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function forecastRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/forecast',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const parsed = querySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() });
      }

      const actor = request.actor!;
      const asOfDate = utcDateOnly(parsed.data.asOf);
      if (Number.isNaN(asOfDate.getTime())) {
        return reply.code(400).send({ error: 'invalid_as_of_date' });
      }

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

        const calendar = calendarFromMetadata(project.metadata);
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
            status: true,
            progress: true,
            startDate: true,
            dueDate: true,
            metadata: true,
          },
        });

        const projectObjects = candidateObjects.filter(
          (object) => projectIdFromMetadata(object.metadata) === project.id,
        );
        const tasks = projectObjects.map((object) => forecastTask({
          id: object.id,
          title: object.title,
          objectTypeKey: object.objectTypeKey,
          status: object.status,
          progress: object.progress,
          startDate: object.startDate,
          dueDate: object.dueDate,
        }, asOfDate, calendar));
        const summary = summarizeForecast(tasks, calendar);

        return {
          kind: 'ok' as const,
          forecast: {
            projectId: project.id,
            workspaceId: project.workspaceId,
            method: 'PROGRESS_VELOCITY_V1' as const,
            asOfDate: asOfDate.toISOString().slice(0, 10),
            calendar: calendar.mode,
            workingWeekdays: calendar.workingWeekdays,
            holidays: calendar.holidays,
            ...summary,
            tasks,
          },
        };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'project_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
      return result.forecast;
    },
  );
}
