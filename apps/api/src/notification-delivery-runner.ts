import { Prisma } from '@prisma/client';
import type { AutomationEventEnvelopeV1 } from './domain/automation-engine-v1.js';
import {
  MicrosoftGraphDeliveryConfigurationError,
  MicrosoftGraphDeliveryError,
  MicrosoftGraphNotificationClient,
} from './microsoft-graph-notification-client.js';
import { withTenant } from './tenant-transaction.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ATTEMPTS = 3;

type DeliveryRow = {
  id: string;
  channel: 'OUTLOOK_EMAIL' | 'TEAMS_ACTIVITY' | 'INTERNAL';
  status: 'PENDING' | 'PROCESSING' | 'DELIVERED' | 'FAILED' | 'SKIPPED';
  title: string;
  body: string | null;
  destination: string | null;
  attempts: number;
};

export interface NotificationDeliveryProcessingResultV1 {
  handled: boolean;
  delivered: boolean;
  retryableFailure: boolean;
  terminal: boolean;
}

function deliveryIdFromEvent(event: AutomationEventEnvelopeV1): string | null {
  if (event.eventType !== 'bridata.notification.delivery.requested') return null;
  const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
    ? event.payload as Record<string, unknown>
    : {};
  const value = typeof payload.deliveryId === 'string' ? payload.deliveryId : event.aggregateId;
  return UUID_RE.test(value) ? value : null;
}

export async function processNotificationDeliveryEventV1(
  event: AutomationEventEnvelopeV1,
  graph: MicrosoftGraphNotificationClient,
): Promise<NotificationDeliveryProcessingResultV1> {
  const deliveryId = deliveryIdFromEvent(event);
  if (!deliveryId) return { handled: false, delivered: false, retryableFailure: false, terminal: true };

  const prepared = await withTenant(event.tenantId, async (tx) => {
    const rows = await tx.$queryRaw<DeliveryRow[]>(Prisma.sql`
      SELECT id, channel, status, title, body, destination, attempts
      FROM notification_deliveries_v1
      WHERE tenant_id = ${event.tenantId}::uuid AND id = ${deliveryId}::uuid
      FOR UPDATE
    `);
    const row = rows[0];
    if (!row) return { kind: 'missing' as const };
    if (row.status === 'DELIVERED' || row.status === 'SKIPPED') return { kind: 'terminal' as const, row };
    if (row.channel === 'INTERNAL') return { kind: 'terminal' as const, row };
    if (row.attempts >= MAX_ATTEMPTS) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE notification_deliveries_v1
        SET status = 'FAILED'::"NotificationDeliveryStatusV1",
            last_error = COALESCE(last_error, 'External notification retry limit reached.'),
            updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${event.tenantId}::uuid AND id = ${deliveryId}::uuid
      `);
      return { kind: 'terminal' as const, row: { ...row, status: 'FAILED' as const } };
    }
    const nextAttempts = row.attempts + 1;
    await tx.$executeRaw(Prisma.sql`
      UPDATE notification_deliveries_v1
      SET status = 'PROCESSING'::"NotificationDeliveryStatusV1",
          attempts = ${nextAttempts}, attempted_at = CURRENT_TIMESTAMP,
          last_error = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${event.tenantId}::uuid AND id = ${deliveryId}::uuid
    `);
    return { kind: 'ready' as const, row: { ...row, attempts: nextAttempts, status: 'PROCESSING' as const } };
  });

  if (prepared.kind === 'missing') return { handled: true, delivered: false, retryableFailure: false, terminal: true };
  if (prepared.kind === 'terminal') {
    return { handled: true, delivered: prepared.row.status === 'DELIVERED', retryableFailure: false, terminal: true };
  }

  const row = prepared.row;
  if (!row.destination) {
    await withTenant(event.tenantId, (tx) => tx.$executeRaw(Prisma.sql`
      UPDATE notification_deliveries_v1
      SET status = 'SKIPPED'::"NotificationDeliveryStatusV1",
          last_error = 'External notification destination is missing.', updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${event.tenantId}::uuid AND id = ${row.id}::uuid
    `));
    return { handled: true, delivered: false, retryableFailure: false, terminal: true };
  }

  try {
    if (row.channel === 'OUTLOOK_EMAIL') {
      await graph.sendOutlookEmail({
        recipientEmail: row.destination,
        subject: row.title,
        body: row.body,
      });
    } else if (row.channel === 'TEAMS_ACTIVITY') {
      await graph.sendTeamsActivity({
        targetEntraUserId: row.destination,
        title: row.title,
        body: row.body,
      });
    }

    await withTenant(event.tenantId, (tx) => tx.$executeRaw(Prisma.sql`
      UPDATE notification_deliveries_v1
      SET status = 'DELIVERED'::"NotificationDeliveryStatusV1",
          delivered_at = CURRENT_TIMESTAMP, last_error = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${event.tenantId}::uuid AND id = ${row.id}::uuid
    `));
    return { handled: true, delivered: true, retryableFailure: false, terminal: true };
  } catch (error) {
    const configurationError = error instanceof MicrosoftGraphDeliveryConfigurationError;
    const graphError = error instanceof MicrosoftGraphDeliveryError ? error : null;
    const retryable = !configurationError
      && row.attempts < MAX_ATTEMPTS
      && (graphError ? graphError.retryable : true);
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 8000);
    const nextStatus = configurationError ? 'SKIPPED' : 'FAILED';

    await withTenant(event.tenantId, (tx) => tx.$executeRaw(Prisma.sql`
      UPDATE notification_deliveries_v1
      SET status = ${nextStatus}::"NotificationDeliveryStatusV1",
          last_error = ${message}, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${event.tenantId}::uuid AND id = ${row.id}::uuid
    `));
    return {
      handled: true,
      delivered: false,
      retryableFailure: retryable,
      terminal: !retryable,
    };
  }
}
