import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { withTenant } from '../tenant-transaction.js';

const listQuerySchema = z.object({
  status: z.enum(['OPEN', 'RESOLVED', 'DISMISSED']).default('OPEN'),
  unread: z.enum(['true', 'false']).optional().transform((value) => value === undefined ? undefined : value === 'true'),
  includeSnoozed: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
const idParamsSchema = z.object({ id: z.string().uuid() });
const snoozeSchema = z.object({ until: z.string().datetime().nullable() });

type InboxRow = {
  id: string;
  workspace_id: string | null;
  project_object_id: string | null;
  source_type: string;
  source_id: string | null;
  title: string;
  body: string | null;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'OPEN' | 'RESOLVED' | 'DISMISSED';
  requires_action: boolean;
  unread: boolean;
  snoozed_until: Date | null;
  read_at: Date | null;
  resolved_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function serialize(row: InboxRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_object_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    title: row.title,
    body: row.body,
    priority: row.priority,
    status: row.status,
    requiresAction: row.requires_action,
    unread: row.unread,
    snoozedUntil: row.snoozed_until?.toISOString() ?? null,
    readAt: row.read_at?.toISOString() ?? null,
    resolvedAt: row.resolved_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function inboxV1Routes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/inbox-v1', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;

    const result = await withTenant(actor.tenantId, async (tx) => {
      const [rows, summaryRows] = await Promise.all([
        tx.$queryRaw<InboxRow[]>(Prisma.sql`
          SELECT id, workspace_id, project_object_id, source_type, source_id, title, body,
                 priority, status, requires_action, unread, snoozed_until, read_at,
                 resolved_at, created_at, updated_at
          FROM inbox_items_v1
          WHERE tenant_id = ${actor.tenantId}::uuid
            AND user_id = ${actor.userId}::uuid
            AND status = ${query.data.status}::"InboxStatusV1"
            AND (${query.data.unread ?? null}::boolean IS NULL OR unread = ${query.data.unread ?? null})
            AND (${query.data.includeSnoozed} OR snoozed_until IS NULL OR snoozed_until <= CURRENT_TIMESTAMP)
          ORDER BY
            CASE priority
              WHEN 'CRITICAL'::"InboxPriorityV1" THEN 4
              WHEN 'HIGH'::"InboxPriorityV1" THEN 3
              WHEN 'MEDIUM'::"InboxPriorityV1" THEN 2
              ELSE 1
            END DESC,
            created_at DESC
          LIMIT ${query.data.limit}
        `),
        tx.$queryRaw<Array<{ unread_count: bigint | number | string; action_count: bigint | number | string; snoozed_count: bigint | number | string }>>(Prisma.sql`
          SELECT
            COUNT(*) FILTER (WHERE status = 'OPEN'::"InboxStatusV1" AND unread = true) AS unread_count,
            COUNT(*) FILTER (WHERE status = 'OPEN'::"InboxStatusV1" AND requires_action = true) AS action_count,
            COUNT(*) FILTER (WHERE status = 'OPEN'::"InboxStatusV1" AND snoozed_until > CURRENT_TIMESTAMP) AS snoozed_count
          FROM inbox_items_v1
          WHERE tenant_id = ${actor.tenantId}::uuid
            AND user_id = ${actor.userId}::uuid
        `),
      ]);
      const summary = summaryRows[0];
      return {
        items: rows.map(serialize),
        summary: {
          unread: Number(summary?.unread_count ?? 0),
          requiresAction: Number(summary?.action_count ?? 0),
          snoozed: Number(summary?.snoozed_count ?? 0),
        },
      };
    });

    return result;
  });

  app.post('/api/v1/inbox-v1/:id/read', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;
    const rows = await withTenant(actor.tenantId, async (tx) => tx.$queryRaw<InboxRow[]>(Prisma.sql`
      UPDATE inbox_items_v1
      SET unread = false,
          read_at = COALESCE(read_at, CURRENT_TIMESTAMP),
          updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${actor.tenantId}::uuid
        AND user_id = ${actor.userId}::uuid
        AND id = ${params.data.id}::uuid
      RETURNING id, workspace_id, project_object_id, source_type, source_id, title, body,
                priority, status, requires_action, unread, snoozed_until, read_at,
                resolved_at, created_at, updated_at
    `));
    if (!rows[0]) return reply.code(404).send({ error: 'inbox_item_not_found' });
    return serialize(rows[0]);
  });

  app.post('/api/v1/inbox-v1/:id/resolve', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;
    const rows = await withTenant(actor.tenantId, async (tx) => tx.$queryRaw<InboxRow[]>(Prisma.sql`
      UPDATE inbox_items_v1
      SET status = 'RESOLVED'::"InboxStatusV1",
          unread = false,
          read_at = COALESCE(read_at, CURRENT_TIMESTAMP),
          resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
          snoozed_until = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${actor.tenantId}::uuid
        AND user_id = ${actor.userId}::uuid
        AND id = ${params.data.id}::uuid
        AND status = 'OPEN'::"InboxStatusV1"
      RETURNING id, workspace_id, project_object_id, source_type, source_id, title, body,
                priority, status, requires_action, unread, snoozed_until, read_at,
                resolved_at, created_at, updated_at
    `));
    if (!rows[0]) return reply.code(404).send({ error: 'open_inbox_item_not_found' });
    return serialize(rows[0]);
  });

  app.post('/api/v1/inbox-v1/:id/dismiss', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;
    const rows = await withTenant(actor.tenantId, async (tx) => tx.$queryRaw<InboxRow[]>(Prisma.sql`
      UPDATE inbox_items_v1
      SET status = 'DISMISSED'::"InboxStatusV1",
          unread = false,
          read_at = COALESCE(read_at, CURRENT_TIMESTAMP),
          snoozed_until = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${actor.tenantId}::uuid
        AND user_id = ${actor.userId}::uuid
        AND id = ${params.data.id}::uuid
        AND status = 'OPEN'::"InboxStatusV1"
      RETURNING id, workspace_id, project_object_id, source_type, source_id, title, body,
                priority, status, requires_action, unread, snoozed_until, read_at,
                resolved_at, created_at, updated_at
    `));
    if (!rows[0]) return reply.code(404).send({ error: 'open_inbox_item_not_found' });
    return serialize(rows[0]);
  });

  app.post('/api/v1/inbox-v1/:id/snooze', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    const body = snoozeSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    const until = body.data.until ? new Date(body.data.until) : null;
    if (until && until.getTime() <= Date.now()) {
      return reply.code(400).send({ error: 'snooze_must_be_future' });
    }
    const actor = request.actor!;
    const rows = await withTenant(actor.tenantId, async (tx) => tx.$queryRaw<InboxRow[]>(Prisma.sql`
      UPDATE inbox_items_v1
      SET snoozed_until = ${until}, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${actor.tenantId}::uuid
        AND user_id = ${actor.userId}::uuid
        AND id = ${params.data.id}::uuid
        AND status = 'OPEN'::"InboxStatusV1"
      RETURNING id, workspace_id, project_object_id, source_type, source_id, title, body,
                priority, status, requires_action, unread, snoozed_until, read_at,
                resolved_at, created_at, updated_at
    `));
    if (!rows[0]) return reply.code(404).send({ error: 'open_inbox_item_not_found' });
    return serialize(rows[0]);
  });
}
