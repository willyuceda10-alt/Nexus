import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor, type ActorContext } from '../auth.js';
import { analyzeResourceCapacity, type ResourceCapacityAssignment, type ResourceCapacityProfile } from '../domain/resource-capacity.js';
import { calendarFromMetadata } from '../domain/work-calendar.js';
import { withTenant } from '../tenant-transaction.js';

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const querySchema = z.object({
  workspaceId: z.string().uuid(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 180;

function asRecord(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, Prisma.JsonValue>;
}

function stringValue(record: Record<string, Prisma.JsonValue>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function numberValue(record: Record<string, Prisma.JsonValue>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function numberArray(record: Record<string, Prisma.JsonValue>, key: string): number[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  const values = value.filter((item): item is number => typeof item === 'number' && Number.isInteger(item));
  return values.length === value.length ? values : undefined;
}

function stringArray(record: Record<string, Prisma.JsonValue>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  const values = value.filter((item): item is string => typeof item === 'string');
  return values.length === value.length ? values : undefined;
}

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

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

export async function resourceCapacityRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/resource-capacity',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const parsed = querySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() });
      }

      const actor = request.actor!;
      const query = parsed.data;
      const from = query.from ? utcDate(query.from) : todayUtc();
      const to = query.to ? utcDate(query.to) : new Date(from.getTime() + 27 * DAY_MS);
      const rangeDays = Math.abs(Math.round((to.getTime() - from.getTime()) / DAY_MS)) + 1;
      if (rangeDays > MAX_RANGE_DAYS) {
        return reply.code(400).send({
          error: 'capacity_range_too_large',
          message: `Resource capacity V1 supports a maximum window of ${MAX_RANGE_DAYS} days.`,
        });
      }

      const result = await withTenant(actor.tenantId, async (tx) => {
        if (!(await canAccessWorkspace(tx, actor, query.workspaceId))) {
          return { kind: 'forbidden' as const };
        }

        const [resourceRows, taskRows, projectRows] = await Promise.all([
          tx.nexusObject.findMany({
            where: {
              tenantId: actor.tenantId,
              workspaceId: query.workspaceId,
              objectTypeKey: 'RESOURCE',
              deletedAt: null,
            },
            select: { id: true, title: true, metadata: true },
          }),
          tx.nexusObject.findMany({
            where: {
              tenantId: actor.tenantId,
              workspaceId: query.workspaceId,
              objectTypeKey: { in: ['TASK', 'DELIVERABLE', 'MILESTONE'] },
              status: { notIn: ['COMPLETED', 'CANCELLED'] },
              assigneeId: { not: null },
              deletedAt: null,
            },
            select: {
              id: true,
              title: true,
              assigneeId: true,
              startDate: true,
              dueDate: true,
              metadata: true,
            },
          }),
          tx.nexusObject.findMany({
            where: {
              tenantId: actor.tenantId,
              workspaceId: query.workspaceId,
              objectTypeKey: 'PROJECT',
              deletedAt: null,
            },
            select: { id: true, metadata: true },
          }),
        ]);

        const projectCalendar = new Map(
          projectRows.map((project) => [project.id, calendarFromMetadata(project.metadata)]),
        );

        const profiles: ResourceCapacityProfile[] = resourceRows.flatMap((row) => {
          const metadata = asRecord(row.metadata);
          const kind = stringValue(metadata, 'resourceKind') ?? 'PERSON';
          if (kind !== 'PERSON') return [];
          const linkedUserId = stringValue(metadata, 'linkedUserId');
          const capacityHoursPerDay = numberValue(metadata, 'capacityHoursPerDay');
          return [{
            resourceId: row.id,
            ...(linkedUserId ? { linkedUserId } : {}),
            name: row.title,
            capacityHoursPerDay: capacityHoursPerDay !== undefined ? Math.max(0, capacityHoursPerDay) : 0,
            workingWeekdays: numberArray(metadata, 'resourceWorkingWeekdays') ?? [1, 2, 3, 4, 5],
            holidays: stringArray(metadata, 'resourceHolidays') ?? [],
          }];
        });

        const assignments: ResourceCapacityAssignment[] = taskRows.map((row) => {
          const metadata = asRecord(row.metadata);
          const projectId = stringValue(metadata, 'projectId');
          return {
            objectId: row.id,
            title: row.title,
            ...(row.assigneeId ? { assigneeId: row.assigneeId } : {}),
            ...(projectId ? { projectId } : {}),
            ...(numberValue(metadata, 'effortHours') !== undefined
              ? { effortHours: numberValue(metadata, 'effortHours') }
              : {}),
            ...(row.startDate ? { startDate: row.startDate } : {}),
            ...(row.dueDate ? { dueDate: row.dueDate } : {}),
            projectCalendar: projectId && projectCalendar.has(projectId)
              ? projectCalendar.get(projectId)!
              : calendarFromMetadata(null),
          };
        });

        return {
          kind: 'ok' as const,
          analysis: analyzeResourceCapacity(profiles, assignments, { from, to }),
          profileCount: profiles.length,
          assignmentCount: assignments.length,
        };
      });

      if (result.kind === 'forbidden') {
        return reply.code(403).send({ error: 'workspace_access_denied' });
      }

      return {
        method: 'EFFORT_DISTRIBUTION_V1',
        generatedAt: new Date().toISOString(),
        workspaceId: query.workspaceId,
        range: { from: dateOnly(from), to: dateOnly(to) },
        profileCount: result.profileCount,
        assignmentCount: result.assignmentCount,
        ...result.analysis,
      };
    },
  );
}
