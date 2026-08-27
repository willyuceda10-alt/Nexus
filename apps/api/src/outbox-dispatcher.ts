import { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { withTenant } from './tenant-transaction.js';
import {
  outboxRetryDelaySeconds,
  type OutboxEventV2,
} from './domain/outbox-dispatch-v2.js';

export interface OutboxTenantPartition {
  tenantId: string;
  lastEventAt: Date;
}

type PartitionRow = { tenant_id: string; last_event_at: Date };
type EventRow = {
  id: string;
  tenant_id: string;
  aggregate_id: string;
  event_type: string;
  payload: Prisma.JsonValue;
  attempts: number;
  idempotency_key: string | null;
  created_at: Date;
};

export interface DomainEventPublisherV2 {
  publish(event: OutboxEventV2): Promise<void>;
  close(): Promise<void>;
}

export async function listDueOutboxTenants(limit: number): Promise<OutboxTenantPartition[]> {
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
  const rows = await prisma.$queryRaw<PartitionRow[]>(Prisma.sql`
    SELECT tenant_id, last_event_at
    FROM outbox_tenant_partitions
    WHERE next_scan_at <= CURRENT_TIMESTAMP
    ORDER BY next_scan_at, tenant_id
    LIMIT ${safeLimit}
  `);
  return rows.map((row) => ({ tenantId: row.tenant_id, lastEventAt: row.last_event_at }));
}

export async function claimTenantOutboxEvents(options: {
  tenantId: string;
  batchSize: number;
  maxAttempts: number;
  lockTimeoutSeconds: number;
}): Promise<OutboxEventV2[]> {
  const batchSize = Math.max(1, Math.min(500, Math.floor(options.batchSize)));
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts));
  const staleBefore = new Date(Date.now() - Math.max(30, options.lockTimeoutSeconds) * 1000);

  return withTenant(options.tenantId, async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      UPDATE domain_events
      SET status = CASE WHEN attempts >= ${maxAttempts}
                        THEN 'FAILED'::"EventStatus"
                        ELSE 'PENDING'::"EventStatus" END,
          locked_at = NULL,
          available_at = CASE WHEN attempts >= ${maxAttempts} THEN available_at ELSE CURRENT_TIMESTAMP END,
          last_error = CASE WHEN attempts >= ${maxAttempts}
                            THEN COALESCE(last_error, 'Outbox lock expired after maximum attempts.')
                            ELSE last_error END
      WHERE tenant_id = ${options.tenantId}::uuid
        AND status = 'PROCESSING'::"EventStatus"
        AND locked_at IS NOT NULL
        AND locked_at < ${staleBefore}
    `);

    const rows = await tx.$queryRaw<EventRow[]>(Prisma.sql`
      WITH candidates AS (
        SELECT id
        FROM domain_events
        WHERE tenant_id = ${options.tenantId}::uuid
          AND status = 'PENDING'::"EventStatus"
          AND attempts < ${maxAttempts}
          AND available_at <= CURRENT_TIMESTAMP
        ORDER BY available_at, created_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
      )
      UPDATE domain_events e
      SET status = 'PROCESSING'::"EventStatus",
          attempts = e.attempts + 1,
          locked_at = CURRENT_TIMESTAMP,
          last_error = NULL
      FROM candidates c
      WHERE e.id = c.id
      RETURNING e.id, e.tenant_id, e.aggregate_id, e.event_type, e.payload,
                e.attempts, e.idempotency_key, e.created_at
    `);

    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      aggregateId: row.aggregate_id,
      eventType: row.event_type,
      payload: row.payload,
      attempts: row.attempts,
      idempotencyKey: row.idempotency_key,
      createdAt: row.created_at,
    }));
  });
}

export async function markOutboxEventProcessed(event: OutboxEventV2): Promise<void> {
  await withTenant(event.tenantId, async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      UPDATE domain_events
      SET status = 'PROCESSED'::"EventStatus",
          processed_at = CURRENT_TIMESTAMP,
          locked_at = NULL,
          last_error = NULL
      WHERE id = ${event.id}::uuid
        AND tenant_id = ${event.tenantId}::uuid
        AND status = 'PROCESSING'::"EventStatus"
    `);
  });
}

export async function markOutboxEventFailed(options: {
  event: OutboxEventV2;
  error: unknown;
  maxAttempts: number;
}): Promise<'RETRY' | 'FAILED'> {
  const message = (options.error instanceof Error ? options.error.message : String(options.error)).slice(0, 8000);
  const terminal = options.event.attempts >= options.maxAttempts;
  const delaySeconds = outboxRetryDelaySeconds(options.event.attempts);
  const availableAt = new Date(Date.now() + delaySeconds * 1000);

  await withTenant(options.event.tenantId, async (tx) => {
    if (terminal) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE domain_events
        SET status = 'FAILED'::"EventStatus",
            locked_at = NULL,
            last_error = ${message}
        WHERE id = ${options.event.id}::uuid
          AND tenant_id = ${options.event.tenantId}::uuid
          AND status = 'PROCESSING'::"EventStatus"
      `);
    } else {
      await tx.$executeRaw(Prisma.sql`
        UPDATE domain_events
        SET status = 'PENDING'::"EventStatus",
            available_at = ${availableAt},
            locked_at = NULL,
            last_error = ${message}
        WHERE id = ${options.event.id}::uuid
          AND tenant_id = ${options.event.tenantId}::uuid
          AND status = 'PROCESSING'::"EventStatus"
      `);
    }
  });
  return terminal ? 'FAILED' : 'RETRY';
}

export async function completeOutboxTenantScan(options: {
  tenantId: string;
  observedLastEventAt: Date;
  claimedCount: number;
  idleDelayMs: number;
}): Promise<void> {
  const nextScanAt = new Date(Date.now() + (options.claimedCount > 0 ? 250 : Math.max(250, options.idleDelayMs)));
  await prisma.$executeRaw(Prisma.sql`
    UPDATE outbox_tenant_partitions
    SET last_scanned_at = CURRENT_TIMESTAMP,
        next_scan_at = CASE
          WHEN last_event_at > ${options.observedLastEventAt} THEN CURRENT_TIMESTAMP
          ELSE ${nextScanAt}
        END
    WHERE tenant_id = ${options.tenantId}::uuid
  `);
}

export async function dispatchTenantOutbox(options: {
  partition: OutboxTenantPartition;
  publisher: DomainEventPublisherV2;
  batchSize: number;
  maxAttempts: number;
  lockTimeoutSeconds: number;
  idleDelayMs: number;
  onError?: (event: OutboxEventV2, error: unknown, terminal: boolean) => void;
}): Promise<number> {
  const events = await claimTenantOutboxEvents({
    tenantId: options.partition.tenantId,
    batchSize: options.batchSize,
    maxAttempts: options.maxAttempts,
    lockTimeoutSeconds: options.lockTimeoutSeconds,
  });

  for (const event of events) {
    try {
      await options.publisher.publish(event);
      await markOutboxEventProcessed(event);
    } catch (error) {
      const result = await markOutboxEventFailed({ event, error, maxAttempts: options.maxAttempts });
      options.onError?.(event, error, result === 'FAILED');
    }
  }

  await completeOutboxTenantScan({
    tenantId: options.partition.tenantId,
    observedLastEventAt: options.partition.lastEventAt,
    claimedCount: events.length,
    idleDelayMs: options.idleDelayMs,
  });
  return events.length;
}
