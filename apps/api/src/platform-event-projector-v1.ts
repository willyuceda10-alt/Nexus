import { Prisma } from '@prisma/client';
import { withTenant } from './tenant-transaction.js';
import type { AutomationEventEnvelopeV1 } from './domain/automation-engine-v1.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

type ProjectedInboxRow = { id: string };

type ProjectionResultV1 = {
  handled: boolean;
  inboxItemId?: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required for internal notification projection.`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${field} exceeds ${maxLength} characters.`);
  return normalized;
}

function optionalString(value: unknown, maxLength: number): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new Error('Notification optional text values must be strings.');
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) throw new Error(`Notification text exceeds ${maxLength} characters.`);
  return normalized;
}

function optionalUuid(value: unknown, field: string): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new Error(`${field} must be a UUID.`);
  return value;
}

export async function projectPlatformEventV1(event: AutomationEventEnvelopeV1): Promise<ProjectionResultV1> {
  if (event.eventType !== 'bridata.notification.requested') return { handled: false };
  if (!UUID_RE.test(event.eventId) || !UUID_RE.test(event.tenantId)) {
    throw new Error('Notification event envelope contains an invalid UUID.');
  }

  const payload = record(event.payload);
  const targetUserId = requiredString(payload.targetUserId, 'targetUserId', 36);
  if (!UUID_RE.test(targetUserId)) throw new Error('targetUserId must be a UUID.');

  const title = requiredString(payload.notificationTitle, 'notificationTitle', 500);
  const body = optionalString(payload.notificationBody, 8000);
  const rawPriority = typeof payload.priority === 'string' ? payload.priority.toUpperCase() : 'MEDIUM';
  if (!PRIORITIES.has(rawPriority)) throw new Error('priority must be LOW, MEDIUM, HIGH or CRITICAL.');
  const requiresAction = payload.requiresAction === true;
  const workspaceId = optionalUuid(payload.scopeWorkspaceId, 'scopeWorkspaceId');
  const projectId = optionalUuid(payload.scopeProjectId, 'scopeProjectId');

  return withTenant(event.tenantId, async (tx) => {
    const recipient = await tx.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId: event.tenantId, userId: targetUserId } },
      include: { user: { select: { isActive: true } } },
    });
    if (!recipient || recipient.status !== 'ACTIVE' || !recipient.user.isActive) {
      throw new Error('Notification target is not an active tenant member.');
    }

    let resolvedWorkspaceId = workspaceId;
    if (projectId) {
      const project = await tx.nexusObject.findFirst({
        where: {
          id: projectId,
          tenantId: event.tenantId,
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
        where: { id: resolvedWorkspaceId, tenantId: event.tenantId },
        select: { id: true },
      });
      if (!workspace) throw new Error('Notification workspace does not exist in the tenant.');
    }

    const inboxRows = await tx.$queryRaw<ProjectedInboxRow[]>(Prisma.sql`
      INSERT INTO inbox_items_v1
        (tenant_id, user_id, workspace_id, project_object_id, source_type, source_id,
         title, body, priority, status, requires_action, unread)
      VALUES
        (${event.tenantId}::uuid, ${targetUserId}::uuid, ${resolvedWorkspaceId}::uuid,
         ${projectId}::uuid, 'AUTOMATION_NOTIFICATION', ${event.eventId}::uuid,
         ${title}, ${body}, ${rawPriority}::"InboxPriorityV1", 'OPEN'::"InboxStatusV1",
         ${requiresAction}, true)
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
        (${event.tenantId}::uuid, ${targetUserId}::uuid, ${inboxItemId}::uuid,
         'INTERNAL'::"NotificationChannelV1", 'DELIVERED'::"NotificationDeliveryStatusV1",
         ${title}, ${body}, CURRENT_TIMESTAMP)
      ON CONFLICT (inbox_item_id, channel)
        WHERE inbox_item_id IS NOT NULL
      DO NOTHING
    `);

    return { handled: true, inboxItemId };
  });
}
