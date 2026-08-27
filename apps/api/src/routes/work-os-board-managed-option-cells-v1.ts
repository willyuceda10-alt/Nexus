import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canManageWorkspace } from '../authorization.js';
import { withTenant } from '../tenant-transaction.js';

const uuid = z.string().uuid();
const paramsSchema = z.object({ boardId: uuid, objectId: uuid, columnId: uuid });
const bodySchema = z.object({ version: z.number().int().positive(), value: z.unknown() });

type BoardRow = { id: string; workspace_id: string; object_definition_id: string };
type ColumnRow = { id: string; source: 'CORE' | 'CUSTOM'; data_type: string; field_key: string; is_editable: boolean };

export async function workOsBoardManagedOptionCellsV1Routes(app: FastifyInstance): Promise<void> {
  app.patch('/api/v1/work-os/boards-v1/:boardId/items/:objectId/managed-option-cells/:columnId', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = bodySchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;

    return withTenant(actor.tenantId, async (tx) => {
      const boardRows = await tx.$queryRaw<BoardRow[]>(Prisma.sql`
        SELECT id, workspace_id, object_definition_id FROM work_boards_v1
        WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${params.data.boardId}::uuid AND is_archived = false LIMIT 1
      `);
      const board = boardRows[0];
      if (!board) return reply.code(404).send({ error: 'board_not_found' });
      if (!(await canManageWorkspace(tx, actor, board.workspace_id))) return reply.code(403).send({ error: 'workspace_manage_denied' });

      const columnRows = await tx.$queryRaw<ColumnRow[]>(Prisma.sql`
        SELECT id, source, data_type, field_key, is_editable FROM work_board_columns_v1
        WHERE tenant_id = ${actor.tenantId}::uuid AND board_id = ${board.id}::uuid AND id = ${params.data.columnId}::uuid LIMIT 1
      `);
      const column = columnRows[0];
      if (!column || !column.is_editable || !['STATUS', 'PRIORITY', 'TAGS'].includes(column.data_type)) {
        return reply.code(409).send({ error: 'managed_option_column_not_editable' });
      }
      if (column.source === 'CORE' && !(
        (column.data_type === 'STATUS' && column.field_key === 'status')
        || (column.data_type === 'PRIORITY' && column.field_key === 'priority')
      )) {
        return reply.code(409).send({ error: 'unsupported_core_managed_option_field' });
      }

      const setRows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM work_board_option_sets_v1
        WHERE tenant_id = ${actor.tenantId}::uuid AND board_id = ${board.id}::uuid AND column_id = ${column.id}::uuid LIMIT 1
      `);
      const optionSet = setRows[0];
      if (!optionSet) return reply.code(409).send({ error: 'managed_option_dictionary_missing' });
      const activeOptions = await tx.$queryRaw<{ key: string }[]>(Prisma.sql`
        SELECT key FROM work_board_options_v1
        WHERE tenant_id = ${actor.tenantId}::uuid AND option_set_id = ${optionSet.id}::uuid AND is_active = true
      `);
      const allowed = new Set(activeOptions.map((option) => option.key));

      let normalized: string | string[] | null;
      if (column.data_type === 'TAGS') {
        if (!Array.isArray(body.data.value) || body.data.value.some((value) => typeof value !== 'string')) {
          return reply.code(400).send({ error: 'tags_value_must_be_string_array' });
        }
        normalized = [...new Set(body.data.value as string[])];
        if (normalized.some((value) => !allowed.has(value))) return reply.code(409).send({ error: 'inactive_or_unknown_option' });
      } else {
        if (body.data.value === null || body.data.value === '') normalized = null;
        else if (typeof body.data.value !== 'string') return reply.code(400).send({ error: 'option_value_must_be_string' });
        else normalized = body.data.value;

        if (column.source === 'CORE' && normalized === null) {
          return reply.code(400).send({ error: 'core_managed_option_value_required' });
        }
        if (normalized !== null && !allowed.has(normalized)) return reply.code(409).send({ error: 'inactive_or_unknown_option' });
      }

      const placement = await tx.$queryRaw<{ exists: boolean }[]>(Prisma.sql`
        SELECT EXISTS(SELECT 1 FROM work_board_item_placements_v1 WHERE tenant_id = ${actor.tenantId}::uuid AND board_id = ${board.id}::uuid AND object_id = ${params.data.objectId}::uuid) AS exists
      `);
      if (!placement[0]?.exists) return reply.code(404).send({ error: 'board_item_not_found' });

      const updated = await tx.nexusObject.updateMany({
        where: {
          id: params.data.objectId,
          tenantId: actor.tenantId,
          workspaceId: board.workspace_id,
          objectDefinitionId: board.object_definition_id,
          version: body.data.version,
          deletedAt: null,
        },
        data: column.source === 'CORE' && column.field_key === 'status'
          ? { status: normalized as string, version: { increment: 1 } }
          : column.source === 'CORE' && column.field_key === 'priority'
            ? { priority: normalized as string, version: { increment: 1 } }
            : { version: { increment: 1 } },
      });
      if (updated.count !== 1) return reply.code(409).send({ error: 'version_conflict' });

      if (column.source === 'CUSTOM') {
        if (normalized === null || (Array.isArray(normalized) && normalized.length === 0)) {
          await tx.objectFieldValue.deleteMany({ where: { tenantId: actor.tenantId, objectId: params.data.objectId, fieldKey: column.field_key } });
        } else if (column.data_type === 'TAGS') {
          await tx.objectFieldValue.upsert({
            where: { objectId_fieldKey: { objectId: params.data.objectId, fieldKey: column.field_key } },
            create: { tenantId: actor.tenantId, objectId: params.data.objectId, fieldKey: column.field_key, valueJson: normalized as Prisma.InputJsonValue },
            update: { valueText: null, valueNumber: null, valueDate: null, valueBoolean: null, valueJson: normalized as Prisma.InputJsonValue },
          });
        } else {
          await tx.objectFieldValue.upsert({
            where: { objectId_fieldKey: { objectId: params.data.objectId, fieldKey: column.field_key } },
            create: { tenantId: actor.tenantId, objectId: params.data.objectId, fieldKey: column.field_key, valueText: normalized as string },
            update: { valueText: normalized as string, valueNumber: null, valueDate: null, valueBoolean: null, valueJson: Prisma.DbNull },
          });
        }
      }

      await Promise.all([
        tx.domainEvent.create({ data: {
          tenantId: actor.tenantId,
          aggregateId: params.data.objectId,
          eventType: 'bridata.work_board.managed_option_changed',
          payload: { boardId: board.id, columnId: column.id, fieldKey: column.field_key, value: normalized, actorId: actor.userId, version: body.data.version + 1 },
        } }),
        tx.auditLog.create({ data: {
          tenantId: actor.tenantId,
          userId: actor.userId,
          action: 'BOARD_MANAGED_OPTION_CELL_UPDATED',
          resource: 'NEXUS_OBJECT',
          resourceId: params.data.objectId,
          correlationId: request.id,
          ipAddress: request.ip,
          details: { boardId: board.id, columnId: column.id, fieldKey: column.field_key, value: normalized },
        } }),
      ]);

      return { objectId: params.data.objectId, version: body.data.version + 1, value: normalized };
    });
  });
}
