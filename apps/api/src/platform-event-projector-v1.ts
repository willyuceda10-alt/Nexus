import { Prisma } from '@prisma/client';
import { parseInternalNotificationRequestV1 } from './domain/internal-notification-v1.js';
import type { AutomationEventEnvelopeV1 } from './domain/automation-engine-v1.js';
import {
  defaultExternalNotificationPreferencesV1,
  externalDeliveryDecisionV1,
  type ExternalNotificationPreferenceV1,
} from './domain/notification-preferences-v1.js';
import { withTenant } from './tenant-transaction.js';

type ProjectedInboxRow = { id: string };
type DeliveryRow = { id: string };
type PreferenceRow = {
  channel: 'OUTLOOK_EMAIL' | 'TEAMS_ACTIVITY';
  enabled: boolean;
  minimum_priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  only_requires_action: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string;
};

type ProjectionResultV1 = {
  handled: boolean;
  inboxItemId?: string;
};

function preferenceFromRow(row: PreferenceRow): ExternalNotificationPreferenceV1 {
  return {
    channel: row.channel,
    enabled: row.enabled,
    minimumPriority: row.minimum_priority,
    onlyRequiresAction: row.only_requires_action,
    quietHoursStart: row.quiet_hours_start,
    quietHoursEnd: row.quiet_hours_end,
    timezone: row.timezone,
  };
}

export async function projectPlatformEventV1(event: AutomationEventEnvelopeV1): Promise<ProjectionResultV1> {
  const request = parseInternalNotificationRequestV1(event);
  if (!request) return { handled: false };

  return withTenant(request.tenantId, async (tx) => {
    const recipient = await tx.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId: request.tenantId, userId: request.targetUserId } },
      include: { user: { select: { isActive: true, email: true } } },
    });
    if (!recipient || recipient.status !== 'ACTIVE' || !recipient.user.isActive) {
      throw new Error('Notification target is not an active tenant member.');
    }

    let resolvedWorkspaceId = request.workspaceId;
    if (request.projectId) {
      const project = await tx.nexusObject.findFirst({
        where: {
          id: request.projectId,
          tenantId: request.tenantId,
          objectTypeKey: 'PROJECT',
          deletedAt: null,
        },
        select: { workspaceId: true },
      });
      if (!project) throw new Error('Notification project does not exist in the tenant.');
      if (resolvedWorkspaceId && resolvedWorkspaceId !== project.workspaceId) {
        throw new Error('Notification project/workspace scope is inconsistent.');
      }
      resolvedWorkspaceId = project.workspaceId;
    } else if (resolvedWorkspaceId) {
      const workspace = await tx.workspace.findFirst({
        where: { id: resolvedWorkspaceId, tenantId: request.tenantId },
        select: { id: true },
      });
      if (!workspace) throw new Error('Notification workspace does not exist in the tenant.');
    }

    if (resolvedWorkspaceId) {
      const workspaceMembership = await tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: resolvedWorkspaceId,
            userId: request.targetUserId,
          },
        },
        select: { tenantId: true },
      });
      if (!workspaceMembership || workspaceMembership.tenantId !== request.tenantId) {
        throw new Error('Notification target is not a member of the automation workspace.');
      }
    }

    const inboxRows = await tx.$queryRaw<ProjectedInboxRow[]>(Prisma.sql`
      INSERT INTO inbox_items_v1
        (tenant_id, user_id, workspace_id, project_object_id, source_type, source_id,
         title, body, priority, status, requires_action, unread)
      VALUES
        (${request.tenantId}::uuid, ${request.targetUserId}::uuid, ${resolvedWorkspaceId}::uuid,
         ${request.projectId}::uuid, 'AUTOMATION_NOTIFICATION', ${request.eventId}::uuid,
         ${request.title}, ${request.body}, ${request.priority}::"InboxPriorityV1", 'OPEN'::"InboxStatusV1",
         ${request.requiresAction}, true)
      ON CONFLICT (tenant_id, user_id, source_type, source_id)
        WHERE source_id IS NOT NULL
      DO UPDATE SET
        title = EXCLUDED.title,
        body = EXCLUDED.body,
        priority = EXCLUDED.priority,
        requires_action = EXCLUDED.requires_action,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `);
    const inboxItemId = inboxRows[0]?.id;
    if (!inboxItemId) throw new Error('Internal notification inbox projection did not return an item id.');

    await tx.$executeRaw(Prisma.sql`
      INSERT INTO notification_deliveries_v1
        (tenant_id, user_id, inbox_item_id, channel, status, title, body, delivered_at)
      VALUES
        (${request.tenantId}::uuid, ${request.targetUserId}::uuid, ${inboxItemId}::uuid,
         'INTERNAL'::"NotificationChannelV1", 'DELIVERED'::"NotificationDeliveryStatusV1",
         ${request.title}, ${request.body}, CURRENT_TIMESTAMP)
      ON CONFLICT (inbox_item_id, channel)
        WHERE inbox_item_id IS NOT NULL
      DO NOTHING
    `);

    const preferenceRows = await tx.$queryRaw<PreferenceRow[]>(Prisma.sql`
      SELECT channel, enabled, minimum_priority, only_requires_action,
             quiet_hours_start, quiet_hours_end, timezone
      FROM notification_preferences_v1
      WHERE tenant_id = ${request.tenantId}::uuid
        AND user_id = ${request.targetUserId}::uuid
        AND channel IN ('OUTLOOK_EMAIL'::"NotificationChannelV1", 'TEAMS_ACTIVITY'::"NotificationChannelV1")
    `);
    const defaults = defaultExternalNotificationPreferencesV1('America/Lima');
    const preferences = defaults.map((fallback) => {
      const row = preferenceRows.find((item) => item.channel === fallback.channel);
      return row ? preferenceFromRow(row) : fallback;
    });

    const entraIdentity = await tx.userIdentity.findFirst({
      where: {
        userId: request.targetUserId,
        provider: 'ENTRA_ID',
        providerTenantId: request.tenantId,
      },
      select: { subject: true },
    });

    for (const preference of preferences) {
      const decision = externalDeliveryDecisionV1(preference, {
        priority: request.priority,
        requiresAction: request.requiresAction,
        occurredAt: event.occurredAt ? new Date(event.occurredAt) : new Date(),
      });
      const destination = preference.channel === 'OUTLOOK_EMAIL'
        ? recipient.user.email
        : entraIdentity?.subject ?? null;
      const canQueue = decision.queue && Boolean(destination);
      const status = canQueue ? 'PENDING' : 'SKIPPED';
      const reason = destination ? decision.reason : 'NO_DESTINATION';

      let deliveryRows = await tx.$queryRaw<DeliveryRow[]>(Prisma.sql`
        INSERT INTO notification_deliveries_v1
          (tenant_id, user_id, inbox_item_id, channel, status, title, body, destination, metadata)
        VALUES
          (${request.tenantId}::uuid, ${request.targetUserId}::uuid, ${inboxItemId}::uuid,
           ${preference.channel}::"NotificationChannelV1", ${status}::"NotificationDeliveryStatusV1",
           ${request.title}, ${request.body}, ${destination}, ${JSON.stringify({ reason })}::jsonb)
        ON CONFLICT (inbox_item_id, channel)
          WHERE inbox_item_id IS NOT NULL
        DO NOTHING
        RETURNING id
      `);
      if (!deliveryRows[0]) {
        deliveryRows = await tx.$queryRaw<DeliveryRow[]>(Prisma.sql`
          SELECT id FROM notification_deliveries_v1
          WHERE tenant_id = ${request.tenantId}::uuid
            AND inbox_item_id = ${inboxItemId}::uuid
            AND channel = ${preference.channel}::"NotificationChannelV1"
          LIMIT 1
        `);
      }
      const deliveryId = deliveryRows[0]?.id;
      if (canQueue && deliveryId) {
        await tx.domainEvent.create({
          data: {
            tenantId: request.tenantId,
            aggregateId: deliveryId,
            eventType: 'bridata.notification.delivery.requested',
            idempotencyKey: `notification-delivery:${deliveryId}`,
            payload: {
              deliveryId,
              userId: request.targetUserId,
              inboxItemId,
              channel: preference.channel,
              workspaceId: resolvedWorkspaceId,
              projectId: request.projectId,
            },
          },
        }).catch((error: unknown) => {
          const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : '';
          if (code !== 'P2002') throw error;
        });
      }
    }

    return { handled: true, inboxItemId };
  });
}
