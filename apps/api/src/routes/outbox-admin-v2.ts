import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { authorizePermission } from '../authorization.js';
import { withTenant } from '../tenant-transaction.js';

const idParamsSchema = z.object({ id: z.string().uuid() });

type CountRow = { status: 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED'; count: bigint | number | string };
type FailedRow = {
  id: string;
  aggregate_id: string;
  event_type: string;
  attempts: number;
  available_at: Date;
  last_error: string | null;
  created_at: Date;
};
type PartitionRow = {
  next_scan_at: Date;
  last_event_at: Date;
  last_scanned_at: Date | null;
};

export async function outboxAdminV2Routes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/outbox/status-v2',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const permission = await authorizePermission(tx, actor, 'tenant.manage_automation');
        if (!permission.allowed) return { kind: 'forbidden' as const };

        const [counts, failed, oldestPending] = await Promise.all([
          tx.$queryRaw<CountRow[]>(Prisma.sql`
            SELECT status, COUNT(*) AS count
            FROM domain_events
            WHERE tenant_id = ${actor.tenantId}::uuid
            GROUP BY status
          `),
          tx.$queryRaw<FailedRow[]>(Prisma.sql`
            SELECT id, aggregate_id, event_type, attempts, available_at, last_error, created_at
            FROM domain_events
            WHERE tenant_id = ${actor.tenantId}::uuid
              AND status = 'FAILED'::"EventStatus"
            ORDER BY created_at DESC
            LIMIT 20
          `),
          tx.$queryRaw<Array<{ created_at: Date | null }>>(Prisma.sql`
            SELECT MIN(created_at) AS created_at
            FROM domain_events
            WHERE tenant_id = ${actor.tenantId}::uuid
              AND status = 'PENDING'::"EventStatus"
          `),
        ]);

        return { kind: 'ok' as const, counts, failed, oldestPending: oldestPending[0]?.created_at ?? null };
      });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'outbox_operations_denied' });

      const partitionRows = await app.prisma?.$queryRaw?.<PartitionRow[]>(Prisma.sql`
        SELECT next_scan_at, last_event_at, last_scanned_at
        FROM outbox_tenant_partitions
        WHERE tenant_id = ${actor.tenantId}::uuid
      `).catch(() => [] as PartitionRow[]) ?? [];

      const counts = Object.fromEntries(['PENDING', 'PROCESSING', 'PROCESSED', 'FAILED'].map((status) => [status, 0]));
      for (const row of result.counts) counts[row.status] = Number(row.count);
      const partition = partitionRows[0];
      return {
        tenantId: actor.tenantId,
        counts,
        oldestPendingAt: result.oldestPending?.toISOString() ?? null,
        partition: partition ? {
          nextScanAt: partition.next_scan_at.toISOString(),
          lastEventAt: partition.last_event_at.toISOString(),
          lastScannedAt: partition.last_scanned_at?.toISOString() ?? null,
        } : null,
        failed: result.failed.map((event) => ({
          id: event.id,
          aggregateId: event.aggregate_id,
          eventType: event.event_type,
          attempts: event.attempts,
          availableAt: event.available_at.toISOString(),
          lastError: event.last_error,
          createdAt: event.created_at.toISOString(),
        })),
      };
    },
  );

  app.post(
    '/api/v1/outbox/events/:id/retry-v2',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = idParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const permission = await authorizePermission(tx, actor, 'tenant.manage_automation');
        if (!permission.allowed) return { kind: 'forbidden' as const };
        const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          UPDATE domain_events
          SET status = 'PENDING'::"EventStatus",
              attempts = 0,
              available_at = CURRENT_TIMESTAMP,
              locked_at = NULL,
              processed_at = NULL,
              last_error = NULL
          WHERE id = ${params.data.id}::uuid
            AND tenant_id = ${actor.tenantId}::uuid
            AND status = 'FAILED'::"EventStatus"
          RETURNING id
        `);
        if (!rows[0]) return { kind: 'not_found' as const };
        await tx.auditLog.create({
          data: {
            tenantId: actor.tenantId,
            userId: actor.userId,
            action: 'OUTBOX_EVENT_RETRY_REQUESTED',
            resource: 'DOMAIN_EVENT',
            resourceId: rows[0].id,
            correlationId: request.id,
            ipAddress: request.ip,
          },
        });
        return { kind: 'ok' as const, id: rows[0].id };
      });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'outbox_operations_denied' });
      if (result.kind === 'not_found') return reply.code(404).send({ error: 'failed_outbox_event_not_found' });
      return { id: result.id, status: 'PENDING', attempts: 0 };
    },
  );
}
