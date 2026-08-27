import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { defaultExternalNotificationPreferencesV1 } from '../domain/notification-preferences-v1.js';
import { withTenant } from '../tenant-transaction.js';

const preferenceSchema = z.object({
  enabled: z.boolean(),
  minimumPriority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  onlyRequiresAction: z.boolean(),
  quietHoursStart: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable(),
  quietHoursEnd: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable(),
  timezone: z.string().trim().min(1).max(100),
});

const updateSchema = z.object({
  outlookEmail: preferenceSchema,
  teamsActivity: preferenceSchema,
});

type PreferenceRow = {
  channel: 'OUTLOOK_EMAIL' | 'TEAMS_ACTIVITY';
  enabled: boolean;
  minimum_priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  only_requires_action: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string;
};

function validTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function validQuietPair(start: string | null, end: string | null): boolean {
  if ((start === null) !== (end === null)) return false;
  return start === null || start !== end;
}

function serializeExternal(row: PreferenceRow) {
  return {
    enabled: row.enabled,
    minimumPriority: row.minimum_priority,
    onlyRequiresAction: row.only_requires_action,
    quietHoursStart: row.quiet_hours_start,
    quietHoursEnd: row.quiet_hours_end,
    timezone: row.timezone,
  };
}

export async function notificationPreferencesV1Routes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/notification-preferences-v1', { preHandler: [authenticate, resolveActor] }, async (request) => {
    const actor = request.actor!;
    const rows = await withTenant(actor.tenantId, (tx) => tx.$queryRaw<PreferenceRow[]>(Prisma.sql`
      SELECT channel, enabled, minimum_priority, only_requires_action,
             quiet_hours_start, quiet_hours_end, timezone
      FROM notification_preferences_v1
      WHERE tenant_id = ${actor.tenantId}::uuid
        AND user_id = ${actor.userId}::uuid
        AND channel IN ('OUTLOOK_EMAIL'::"NotificationChannelV1", 'TEAMS_ACTIVITY'::"NotificationChannelV1")
    `));

    const defaults = defaultExternalNotificationPreferencesV1('America/Lima');
    const outlook = rows.find((row) => row.channel === 'OUTLOOK_EMAIL');
    const teams = rows.find((row) => row.channel === 'TEAMS_ACTIVITY');
    const defaultOutlook = defaults.find((item) => item.channel === 'OUTLOOK_EMAIL')!;
    const defaultTeams = defaults.find((item) => item.channel === 'TEAMS_ACTIVITY')!;

    return {
      version: 1,
      internal: { enabled: true, canonical: true },
      outlookEmail: outlook ? serializeExternal(outlook) : {
        enabled: defaultOutlook.enabled,
        minimumPriority: defaultOutlook.minimumPriority,
        onlyRequiresAction: defaultOutlook.onlyRequiresAction,
        quietHoursStart: defaultOutlook.quietHoursStart,
        quietHoursEnd: defaultOutlook.quietHoursEnd,
        timezone: defaultOutlook.timezone,
      },
      teamsActivity: teams ? serializeExternal(teams) : {
        enabled: defaultTeams.enabled,
        minimumPriority: defaultTeams.minimumPriority,
        onlyRequiresAction: defaultTeams.onlyRequiresAction,
        quietHoursStart: defaultTeams.quietHoursStart,
        quietHoursEnd: defaultTeams.quietHoursEnd,
        timezone: defaultTeams.timezone,
      },
    };
  });

  app.put('/api/v1/notification-preferences-v1', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const body = updateSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'validation_error', details: body.error.flatten() });

    for (const value of [body.data.outlookEmail, body.data.teamsActivity]) {
      if (!validTimezone(value.timezone)) {
        return reply.code(400).send({ error: 'invalid_notification_timezone', message: `Unknown timezone: ${value.timezone}` });
      }
      if (!validQuietPair(value.quietHoursStart, value.quietHoursEnd)) {
        return reply.code(400).send({ error: 'invalid_quiet_hours', message: 'Quiet hours require distinct start and end values.' });
      }
    }

    const actor = request.actor!;
    await withTenant(actor.tenantId, async (tx) => {
      const entries = [
        { channel: 'OUTLOOK_EMAIL', value: body.data.outlookEmail },
        { channel: 'TEAMS_ACTIVITY', value: body.data.teamsActivity },
      ] as const;

      for (const entry of entries) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO notification_preferences_v1
            (tenant_id, user_id, channel, enabled, minimum_priority, only_requires_action,
             quiet_hours_start, quiet_hours_end, timezone)
          VALUES
            (${actor.tenantId}::uuid, ${actor.userId}::uuid,
             ${entry.channel}::"NotificationChannelV1", ${entry.value.enabled},
             ${entry.value.minimumPriority}::"InboxPriorityV1", ${entry.value.onlyRequiresAction},
             ${entry.value.quietHoursStart}, ${entry.value.quietHoursEnd}, ${entry.value.timezone})
          ON CONFLICT (tenant_id, user_id, channel)
          DO UPDATE SET
            enabled = EXCLUDED.enabled,
            minimum_priority = EXCLUDED.minimum_priority,
            only_requires_action = EXCLUDED.only_requires_action,
            quiet_hours_start = EXCLUDED.quiet_hours_start,
            quiet_hours_end = EXCLUDED.quiet_hours_end,
            timezone = EXCLUDED.timezone,
            updated_at = CURRENT_TIMESTAMP
        `);
      }

      await Promise.all([
        tx.auditLog.create({
          data: {
            tenantId: actor.tenantId,
            userId: actor.userId,
            action: 'NOTIFICATION_PREFERENCES_UPDATED',
            resource: 'NOTIFICATION_PREFERENCES',
            resourceId: actor.userId,
            correlationId: request.id,
            ipAddress: request.ip,
            details: {
              outlookEmail: body.data.outlookEmail.enabled,
              teamsActivity: body.data.teamsActivity.enabled,
            },
          },
        }),
        tx.domainEvent.create({
          data: {
            tenantId: actor.tenantId,
            aggregateId: actor.userId,
            eventType: 'bridata.notification.preferences.updated',
            idempotencyKey: `notification-preferences:${actor.userId}:${request.id}`,
            payload: {
              userId: actor.userId,
              outlookEmailEnabled: body.data.outlookEmail.enabled,
              teamsActivityEnabled: body.data.teamsActivity.enabled,
            },
          },
        }),
      ]);
    });

    return reply.code(204).send();
  });
}
