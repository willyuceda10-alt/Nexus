import { Prisma } from '@prisma/client';
import { parseInternalNotificationRequestV1 } from './domain/internal-notification-v1.js';
import type { AutomationEventEnvelopeV1 } from './domain/automation-engine-v1.js';
import { withTenant } from './tenant-transaction.js';

type ProjectedInboxRow = { id: string };

type ProjectionResultV1 = {
  handled: boolean;
  inboxItemId?: string;
};

export async function projectPlatformEventV1(event: AutomationEventEnvelopeV1): Promise<ProjectionResultV1> {
  const request = parseInternalNotificationRequestV1(event);
  if (!request) return { handled: false };

  return withTenant(request.tenantId, async (tx) => {
    const recipient = await tx.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId: request.tenantId, userId: request.targetUserId } },
      include: { user: { select: { isActive: true } } },
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

    return { handled: true, inboxItemId };
  });
}
