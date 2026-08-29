import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canAccessWorkspace, canManageWorkspace } from '../authorization.js';
import { validateWorkCalendarV2 } from '../domain/work-calendar-v2.js';
import { withTenant } from '../tenant-transaction.js';

const listQuerySchema = z.object({
  workspaceId: z.string().uuid(),
});

const calendarBodySchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().trim().min(1).max(255),
  timezone: z.string().trim().min(1).max(100).default('UTC'),
  workingWeekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).default([1, 2, 3, 4, 5]),
  minutesPerDay: z.number().int().min(1).max(1440).default(480),
  isDefault: z.boolean().default(false),
});

const calendarPatchSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  workingWeekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  minutesPerDay: z.number().int().min(1).max(1440).optional(),
  isDefault: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one calendar field is required.',
});

const idParamsSchema = z.object({ id: z.string().uuid() });
const exceptionParamsSchema = z.object({
  id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const exceptionBodySchema = z.object({
  name: z.string().trim().min(1).max(255).nullable().optional(),
  isWorking: z.boolean(),
  workingMinutes: z.number().int().min(0).max(1440).nullable().optional(),
});

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function serializeCalendar(row: {
  id: string;
  workspaceId: string;
  name: string;
  timezone: string;
  workingWeekdays: number[];
  minutesPerDay: number;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
  exceptions?: Array<{
    id: string;
    exceptionDate: Date;
    name: string | null;
    isWorking: boolean;
    workingMinutes: number | null;
  }>;
}) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    timezone: row.timezone,
    workingWeekdays: row.workingWeekdays,
    minutesPerDay: row.minutesPerDay,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    exceptions: (row.exceptions ?? []).map((entry) => ({
      id: entry.id,
      exceptionDate: dateOnly(entry.exceptionDate),
      name: entry.name,
      isWorking: entry.isWorking,
      workingMinutes: entry.workingMinutes,
    })),
  };
}

export async function workCalendarV2Routes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/work-calendars',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const parsed = listQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() });
      }

      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        if (!(await canAccessWorkspace(tx, actor, parsed.data.workspaceId))) {
          return { kind: 'forbidden' as const };
        }
        const rows = await tx.workCalendar.findMany({
          where: { tenantId: actor.tenantId, workspaceId: parsed.data.workspaceId },
          include: { exceptions: { orderBy: { exceptionDate: 'asc' } } },
          orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        });
        return { kind: 'ok' as const, rows };
      });

      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
      return { items: result.rows.map(serializeCalendar) };
    },
  );

  app.post(
    '/api/v1/work-calendars',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const parsed = calendarBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() });
      }
      const actor = request.actor!;
      const data = parsed.data;

      try {
        validateWorkCalendarV2({
          timezone: data.timezone,
          workingWeekdays: data.workingWeekdays,
          minutesPerDay: data.minutesPerDay,
          exceptions: [],
        });
      } catch (error) {
        return reply.code(400).send({ error: 'invalid_work_calendar', message: (error as Error).message });
      }

      const result = await withTenant(actor.tenantId, async (tx) => {
        if (!(await canManageWorkspace(tx, actor, data.workspaceId))) {
          return { kind: 'forbidden' as const };
        }
        const workspace = await tx.workspace.findFirst({
          where: { id: data.workspaceId, tenantId: actor.tenantId },
          select: { id: true },
        });
        if (!workspace) return { kind: 'not_found' as const };

        if (data.isDefault) {
          await tx.workCalendar.updateMany({
            where: { tenantId: actor.tenantId, workspaceId: data.workspaceId, isDefault: true },
            data: { isDefault: false },
          });
        }

        const calendar = await tx.workCalendar.create({
          data: {
            tenantId: actor.tenantId,
            workspaceId: data.workspaceId,
            name: data.name,
            timezone: data.timezone,
            workingWeekdays: data.workingWeekdays,
            minutesPerDay: data.minutesPerDay,
            isDefault: data.isDefault,
          },
          include: { exceptions: true },
        });

        await Promise.all([
          tx.domainEvent.create({
            data: {
              tenantId: actor.tenantId,
              aggregateId: calendar.id,
              eventType: 'bridata.work_calendar.created',
              payload: { calendarId: calendar.id, workspaceId: data.workspaceId, actorId: actor.userId },
            },
          }),
          tx.auditLog.create({
            data: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              action: 'WORK_CALENDAR_CREATED',
              resource: 'WORK_CALENDAR',
              resourceId: calendar.id,
              correlationId: request.id,
              ipAddress: request.ip,
              details: { workspaceId: data.workspaceId, name: data.name },
            },
          }),
        ]);

        return { kind: 'created' as const, calendar };
      });

      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'calendar_management_denied' });
      if (result.kind === 'not_found') return reply.code(404).send({ error: 'workspace_not_found' });
      return reply.code(201).send(serializeCalendar(result.calendar));
    },
  );

  app.patch(
    '/api/v1/work-calendars/:id',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = idParamsSchema.safeParse(request.params);
      const body = calendarPatchSchema.safeParse(request.body);
      if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;

      const result = await withTenant(actor.tenantId, async (tx) => {
        const current = await tx.workCalendar.findFirst({
          where: { id: params.data.id, tenantId: actor.tenantId },
          include: { exceptions: true },
        });
        if (!current) return { kind: 'not_found' as const };
        if (!(await canManageWorkspace(tx, actor, current.workspaceId))) {
          return { kind: 'forbidden' as const };
        }

        const next = {
          timezone: body.data.timezone ?? current.timezone,
          workingWeekdays: body.data.workingWeekdays ?? current.workingWeekdays,
          minutesPerDay: body.data.minutesPerDay ?? current.minutesPerDay,
          exceptions: current.exceptions.map((entry) => ({
            exceptionDate: entry.exceptionDate,
            isWorking: entry.isWorking,
            workingMinutes: entry.workingMinutes,
          })),
        };
        try {
          validateWorkCalendarV2(next);
        } catch (error) {
          return { kind: 'invalid' as const, message: (error as Error).message };
        }

        if (body.data.isDefault === true) {
          await tx.workCalendar.updateMany({
            where: {
              tenantId: actor.tenantId,
              workspaceId: current.workspaceId,
              isDefault: true,
              id: { not: current.id },
            },
            data: { isDefault: false },
          });
        }

        const calendar = await tx.workCalendar.update({
          where: { id: current.id },
          data: {
            ...(body.data.name !== undefined ? { name: body.data.name } : {}),
            ...(body.data.timezone !== undefined ? { timezone: body.data.timezone } : {}),
            ...(body.data.isDefault !== undefined ? { isDefault: body.data.isDefault } : {}),
            ...(body.data.workingWeekdays !== undefined ? { workingWeekdays: body.data.workingWeekdays } : {}),
            ...(body.data.minutesPerDay !== undefined ? { minutesPerDay: body.data.minutesPerDay } : {}),
          },
          include: { exceptions: { orderBy: { exceptionDate: 'asc' } } },
        });
        await tx.auditLog.create({
          data: {
            tenantId: actor.tenantId,
            userId: actor.userId,
            action: 'WORK_CALENDAR_UPDATED',
            resource: 'WORK_CALENDAR',
            resourceId: current.id,
            correlationId: request.id,
            ipAddress: request.ip,
            details: body.data,
          },
        });
        return { kind: 'updated' as const, calendar };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'calendar_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'calendar_management_denied' });
      if (result.kind === 'invalid') return reply.code(400).send({ error: 'invalid_work_calendar', message: result.message });
      return serializeCalendar(result.calendar);
    },
  );

  app.put(
    '/api/v1/work-calendars/:id/exceptions/:date',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = exceptionParamsSchema.safeParse(request.params);
      const body = exceptionBodySchema.safeParse(request.body);
      if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      const exceptionDate = new Date(`${params.data.date}T00:00:00.000Z`);

      const result = await withTenant(actor.tenantId, async (tx) => {
        const calendar = await tx.workCalendar.findFirst({
          where: { id: params.data.id, tenantId: actor.tenantId },
          select: { id: true, workspaceId: true, minutesPerDay: true },
        });
        if (!calendar) return { kind: 'not_found' as const };
        if (!(await canManageWorkspace(tx, actor, calendar.workspaceId))) {
          return { kind: 'forbidden' as const };
        }
        const workingMinutes = body.data.isWorking
          ? (body.data.workingMinutes ?? calendar.minutesPerDay)
          : 0;
        const exception = await tx.workCalendarException.upsert({
          where: { calendarId_exceptionDate: { calendarId: calendar.id, exceptionDate } },
          create: {
            tenantId: actor.tenantId,
            calendarId: calendar.id,
            exceptionDate,
            name: body.data.name ?? null,
            isWorking: body.data.isWorking,
            workingMinutes,
          },
          update: {
            name: body.data.name ?? null,
            isWorking: body.data.isWorking,
            workingMinutes,
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId: actor.tenantId,
            userId: actor.userId,
            action: 'WORK_CALENDAR_EXCEPTION_UPSERTED',
            resource: 'WORK_CALENDAR',
            resourceId: calendar.id,
            correlationId: request.id,
            ipAddress: request.ip,
            details: { exceptionDate: params.data.date, isWorking: body.data.isWorking, workingMinutes },
          },
        });
        return { kind: 'saved' as const, exception };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'calendar_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'calendar_management_denied' });
      return {
        id: result.exception.id,
        exceptionDate: dateOnly(result.exception.exceptionDate),
        name: result.exception.name,
        isWorking: result.exception.isWorking,
        workingMinutes: result.exception.workingMinutes,
      };
    },
  );

  app.delete(
    '/api/v1/work-calendars/:id/exceptions/:date',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = exceptionParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      const exceptionDate = new Date(`${params.data.date}T00:00:00.000Z`);

      const result = await withTenant(actor.tenantId, async (tx) => {
        const calendar = await tx.workCalendar.findFirst({
          where: { id: params.data.id, tenantId: actor.tenantId },
          select: { id: true, workspaceId: true },
        });
        if (!calendar) return { kind: 'not_found' as const };
        if (!(await canManageWorkspace(tx, actor, calendar.workspaceId))) {
          return { kind: 'forbidden' as const };
        }
        await tx.workCalendarException.deleteMany({
          where: { tenantId: actor.tenantId, calendarId: calendar.id, exceptionDate },
        });
        await tx.auditLog.create({
          data: {
            tenantId: actor.tenantId,
            userId: actor.userId,
            action: 'WORK_CALENDAR_EXCEPTION_DELETED',
            resource: 'WORK_CALENDAR',
            resourceId: calendar.id,
            correlationId: request.id,
            ipAddress: request.ip,
            details: { exceptionDate: params.data.date },
          },
        });
        return { kind: 'deleted' as const };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'calendar_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'calendar_management_denied' });
      return reply.code(204).send();
    },
  );
}
