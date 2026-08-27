import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canAccessWorkspace } from '../authorization.js';
import {
  evaluateBoardFormulaV1,
  formatBoardFormulaValueV1,
  type BoardFormulaExpressionV1,
} from '../domain/board-formula-v1.js';
import { withTenant } from '../tenant-transaction.js';

const paramsSchema = z.object({ boardId: z.string().uuid() });

type BoardRow = { id: string; workspace_id: string; object_definition_id: string };
type ColumnRow = {
  id: string;
  data_type: 'FORMULA' | 'RELATION';
  field_key: string;
  config: Record<string, unknown> | null;
};

export async function workOsBoardComputedV1Routes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/work-os/boards-v1/:boardId/computed-values', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;

    return withTenant(actor.tenantId, async (tx) => {
      const boardRows = await tx.$queryRaw<BoardRow[]>(Prisma.sql`
        SELECT id, workspace_id, object_definition_id
        FROM work_boards_v1
        WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${params.data.boardId}::uuid AND is_archived = false
        LIMIT 1
      `);
      const board = boardRows[0];
      if (!board) return reply.code(404).send({ error: 'board_not_found' });
      if (!(await canAccessWorkspace(tx, actor, board.workspace_id))) return reply.code(403).send({ error: 'workspace_access_denied' });

      const columns = await tx.$queryRaw<ColumnRow[]>(Prisma.sql`
        SELECT id, data_type, field_key, config
        FROM work_board_columns_v1
        WHERE tenant_id = ${actor.tenantId}::uuid AND board_id = ${board.id}::uuid
          AND data_type IN ('FORMULA'::"WorkBoardColumnTypeV1", 'RELATION'::"WorkBoardColumnTypeV1")
        ORDER BY sort_order, id
      `);
      if (!columns.length) return { valuesByObjectId: {} };

      const placements = await tx.$queryRaw<{ object_id: string }[]>(Prisma.sql`
        SELECT object_id FROM work_board_item_placements_v1
        WHERE tenant_id = ${actor.tenantId}::uuid AND board_id = ${board.id}::uuid
      `);
      const objectIds = placements.map((row) => row.object_id);
      if (!objectIds.length) return { valuesByObjectId: {} };

      const objects = await tx.nexusObject.findMany({
        where: { tenantId: actor.tenantId, id: { in: objectIds }, deletedAt: null },
        select: {
          id: true,
          progress: true,
          fieldValues: { select: { fieldKey: true, valueNumber: true, valueText: true, valueBoolean: true, valueDate: true, valueJson: true } },
        },
      });
      const valuesByObjectId: Record<string, Record<string, unknown>> = Object.fromEntries(objects.map((object) => [object.id, {}]));

      const formulaColumns = columns.filter((column) => column.data_type === 'FORMULA');
      for (const object of objects) {
        const raw = new Map<string, unknown>();
        raw.set('progress', object.progress);
        for (const field of object.fieldValues) {
          raw.set(field.fieldKey,
            field.valueNumber !== null ? Number(field.valueNumber)
              : field.valueText ?? field.valueBoolean ?? field.valueDate ?? field.valueJson ?? null);
        }
        for (const column of formulaColumns) {
          const config = (column.config ?? {}) as {
            formula?: BoardFormulaExpressionV1;
            format?: 'NUMBER' | 'CURRENCY' | 'PERCENT';
            decimals?: number;
            currency?: string | null;
          };
          if (!config.formula) {
            valuesByObjectId[object.id]![column.field_key] = null;
            continue;
          }
          const value = evaluateBoardFormulaV1(config.formula, (fieldKey) => raw.get(fieldKey));
          valuesByObjectId[object.id]![column.field_key] = formatBoardFormulaValueV1(value, {
            ...(config.format ? { format: config.format } : {}),
            ...(config.decimals !== undefined ? { decimals: config.decimals } : {}),
            ...(config.currency ? { currency: config.currency } : {}),
          });
        }
      }

      for (const column of columns.filter((item) => item.data_type === 'RELATION')) {
        const config = (column.config ?? {}) as { relationType?: string };
        if (!config.relationType) continue;
        const relations = await tx.objectRelation.findMany({
          where: {
            tenantId: actor.tenantId,
            sourceObjectId: { in: objectIds },
            relationType: config.relationType,
          },
          select: {
            sourceObjectId: true,
            targetObject: { select: { id: true, title: true, status: true, objectTypeKey: true } },
          },
          orderBy: { createdAt: 'asc' },
        });
        for (const relation of relations) {
          const targetList = (valuesByObjectId[relation.sourceObjectId]?.[column.field_key] as unknown[] | undefined) ?? [];
          valuesByObjectId[relation.sourceObjectId]![column.field_key] = [...targetList, relation.targetObject];
        }
        for (const objectId of objectIds) {
          if (valuesByObjectId[objectId]![column.field_key] === undefined) valuesByObjectId[objectId]![column.field_key] = [];
        }
      }

      return { valuesByObjectId };
    });
  });
}
