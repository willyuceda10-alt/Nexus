import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canManageWorkspace } from '../authorization.js';
import { withTenant } from '../tenant-transaction.js';

const uuid = z.string().uuid();
const paramsSchema = z.object({ boardId: uuid, columnId: uuid });
const safeOptionKey = z.string().trim().min(1).max(100).regex(/^[A-Za-z][A-Za-z0-9_.-]{0,99}$/);
const bodySchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  options: z.array(z.object({
    key: safeOptionKey,
    label: z.string().trim().min(1).max(255),
    color: z.string().trim().max(30).nullable().optional(),
  })).min(1).max(50),
});

type BoardRow = { id: string; workspace_id: string };
type ColumnRow = { id: string; label: string; data_type: string };
type SetRow = { id: string; column_id: string; name: string; allow_multiple: boolean };

export async function workOsBoardManagedOptionsV1Routes(app: FastifyInstance): Promise<void> {
  app.put('/api/v1/work-os/boards-v1/:boardId/columns/:columnId/managed-options', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = bodySchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error', details: body.success ? undefined : body.error.flatten() });
    const actor = request.actor!;

    return withTenant(actor.tenantId, async (tx) => {
      const boardRows = await tx.$queryRaw<BoardRow[]>(Prisma.sql`
        SELECT id, workspace_id FROM work_boards_v1
        WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${params.data.boardId}::uuid AND is_archived = false
        LIMIT 1
      `);
      const board = boardRows[0];
      if (!board) return reply.code(404).send({ error: 'board_not_found' });
      if (!(await canManageWorkspace(tx, actor, board.workspace_id))) return reply.code(403).send({ error: 'workspace_manage_denied' });

      const columnRows = await tx.$queryRaw<ColumnRow[]>(Prisma.sql`
        SELECT id, label, data_type FROM work_board_columns_v1
        WHERE tenant_id = ${actor.tenantId}::uuid AND board_id = ${board.id}::uuid AND id = ${params.data.columnId}::uuid
        LIMIT 1
      `);
      const column = columnRows[0];
      if (!column) return reply.code(404).send({ error: 'column_not_found' });
      if (!['STATUS', 'PRIORITY', 'TAGS'].includes(column.data_type)) return reply.code(409).send({ error: 'column_does_not_support_options' });

      const keys = body.data.options.map((option) => option.key);
      if (new Set(keys).size !== keys.length) return reply.code(400).send({ error: 'duplicate_option_key' });

      const setRows = await tx.$queryRaw<SetRow[]>(Prisma.sql`
        INSERT INTO work_board_option_sets_v1 (tenant_id, board_id, column_id, name, allow_multiple)
        VALUES (${actor.tenantId}::uuid, ${board.id}::uuid, ${column.id}::uuid, ${body.data.name ?? column.label}, ${column.data_type === 'TAGS'})
        ON CONFLICT (column_id) DO UPDATE
        SET name = EXCLUDED.name, allow_multiple = EXCLUDED.allow_multiple, updated_at = CURRENT_TIMESTAMP
        RETURNING id, column_id, name, allow_multiple
      `);
      const optionSet = setRows[0]!;

      await tx.$executeRaw(Prisma.sql`
        UPDATE work_board_options_v1
        SET is_active = false, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${actor.tenantId}::uuid AND option_set_id = ${optionSet.id}::uuid
          AND NOT (key = ANY(${keys}::text[]))
      `);
      for (const [index, option] of body.data.options.entries()) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO work_board_options_v1 (tenant_id, option_set_id, key, label, color, sort_order, is_active)
          VALUES (${actor.tenantId}::uuid, ${optionSet.id}::uuid, ${option.key}, ${option.label}, ${option.color ?? null}, ${(index + 1) * 10}, true)
          ON CONFLICT (option_set_id, key) DO UPDATE
          SET label = EXCLUDED.label, color = EXCLUDED.color, sort_order = EXCLUDED.sort_order, is_active = true, updated_at = CURRENT_TIMESTAMP
        `);
      }

      await tx.auditLog.create({ data: {
        tenantId: actor.tenantId, userId: actor.userId, action: 'BOARD_OPTION_DICTIONARY_UPDATED', resource: 'WORK_BOARD_COLUMN_V1',
        resourceId: column.id, correlationId: request.id, ipAddress: request.ip,
        details: { boardId: board.id, optionCount: body.data.options.length, optionKeys: keys },
      } });

      return {
        id: optionSet.id,
        columnId: optionSet.column_id,
        name: optionSet.name,
        allowMultiple: optionSet.allow_multiple,
        options: body.data.options.map((option, index) => ({ ...option, sortOrder: (index + 1) * 10, isActive: true })),
      };
    });
  });
}
