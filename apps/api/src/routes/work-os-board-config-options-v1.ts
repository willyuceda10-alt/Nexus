import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canAccessWorkspace, canManageWorkspace } from '../authorization.js';
import {
  BoardFormulaValidationError,
  validateBoardFormulaV1,
  type BoardFormulaExpressionV1,
} from '../domain/board-formula-v1.js';
import { normalizeBoardKeyV1 } from '../domain/board-view-v1.js';
import { withTenant } from '../tenant-transaction.js';

const uuid = z.string().uuid();
const boardParams = z.object({ boardId: uuid });
const boardColumnParams = z.object({ boardId: uuid, columnId: uuid });
const boardObjectColumnParams = z.object({ boardId: uuid, objectId: uuid, columnId: uuid });
const relationCandidatesQuery = z.object({ search: z.string().trim().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });

const optionInput = z.object({
  key: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(255),
  color: z.string().trim().max(30).nullable().optional(),
});
const replaceOptionsSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  options: z.array(optionInput).min(1).max(50),
});

const formulaOperandSchema: z.ZodType<BoardFormulaExpressionV1> = z.lazy(() => z.union([
  z.object({ kind: z.literal('FIELD'), fieldKey: z.string().trim().min(1).max(100) }),
  z.object({ kind: z.literal('LITERAL'), value: z.number().finite() }),
  z.object({
    kind: z.literal('BINARY'),
    op: z.enum(['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX']),
    left: formulaOperandSchema,
    right: formulaOperandSchema,
  }),
]));

const createFormulaColumnSchema = z.object({
  label: z.string().trim().min(1).max(255),
  fieldKey: z.string().trim().min(1).max(100),
  expression: formulaOperandSchema,
  format: z.enum(['NUMBER', 'CURRENCY', 'PERCENT']).default('NUMBER'),
  decimals: z.number().int().min(0).max(4).default(2),
  currency: z.string().trim().min(3).max(3).optional(),
});

const createRelationColumnSchema = z.object({
  label: z.string().trim().min(1).max(255),
  fieldKey: z.string().trim().min(1).max(100),
  targetBoardId: uuid,
  multiple: z.boolean().default(false),
});

const relationCellSchema = z.object({
  version: z.number().int().positive(),
  targetObjectIds: z.array(uuid).max(50),
});
const personCellSchema = z.object({
  version: z.number().int().positive(),
  userId: uuid.nullable(),
});

type BoardRow = { id: string; workspace_id: string; object_definition_id: string; name: string };
type ColumnRow = {
  id: string; key: string; label: string; source: 'CORE' | 'CUSTOM'; data_type: string; field_key: string;
  is_editable: boolean; config: Record<string, unknown> | null;
};
type OptionSetRow = { id: string; column_id: string; name: string; allow_multiple: boolean };
type OptionRow = { id: string; option_set_id: string; key: string; label: string; color: string | null; sort_order: number; is_active: boolean };

async function getBoard(tx: Prisma.TransactionClient, tenantId: string, boardId: string): Promise<BoardRow | null> {
  const rows = await tx.$queryRaw<BoardRow[]>(Prisma.sql`
    SELECT id, workspace_id, object_definition_id, name
    FROM work_boards_v1
    WHERE tenant_id = ${tenantId}::uuid AND id = ${boardId}::uuid AND is_archived = false
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function getColumn(tx: Prisma.TransactionClient, tenantId: string, boardId: string, columnId: string): Promise<ColumnRow | null> {
  const rows = await tx.$queryRaw<ColumnRow[]>(Prisma.sql`
    SELECT id, key, label, source, data_type, field_key, is_editable, config
    FROM work_board_columns_v1
    WHERE tenant_id = ${tenantId}::uuid AND board_id = ${boardId}::uuid AND id = ${columnId}::uuid
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function assertPlacedObject(
  tx: Prisma.TransactionClient,
  tenantId: string,
  board: BoardRow,
  objectId: string,
): Promise<{ id: string; version: number } | null> {
  const placed = await tx.$queryRaw<{ exists: boolean }[]>(Prisma.sql`
    SELECT EXISTS(
      SELECT 1 FROM work_board_item_placements_v1
      WHERE tenant_id = ${tenantId}::uuid AND board_id = ${board.id}::uuid AND object_id = ${objectId}::uuid
    ) AS exists
  `);
  if (!placed[0]?.exists) return null;
  return tx.nexusObject.findFirst({
    where: { id: objectId, tenantId, workspaceId: board.workspace_id, objectDefinitionId: board.object_definition_id, deletedAt: null },
    select: { id: true, version: true },
  });
}

function asFormulaConfig(column: ColumnRow): { targetBoardId?: string; relationType?: string; multiple?: boolean } {
  return (column.config ?? {}) as { targetBoardId?: string; relationType?: string; multiple?: boolean };
}

export async function workOsBoardConfigOptionsV1Routes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/work-os/boards-v1/:boardId/configuration', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = boardParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      const board = await getBoard(tx, actor.tenantId, params.data.boardId);
      if (!board) return reply.code(404).send({ error: 'board_not_found' });
      if (!(await canAccessWorkspace(tx, actor, board.workspace_id))) return reply.code(403).send({ error: 'workspace_access_denied' });

      const [people, boards, optionSets, options] = await Promise.all([
        tx.workspaceMember.findMany({
          where: {
            tenantId: actor.tenantId,
            workspaceId: board.workspace_id,
            user: {
              isActive: true,
              tenantMemberships: { some: { tenantId: actor.tenantId, status: 'ACTIVE' } },
            },
          },
          orderBy: [{ user: { fullName: 'asc' } }],
          select: {
            role: true,
            user: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
          },
        }),
        tx.$queryRaw<Array<{ id: string; name: string; object_definition_id: string }>>(Prisma.sql`
          SELECT id, name, object_definition_id
          FROM work_boards_v1
          WHERE tenant_id = ${actor.tenantId}::uuid AND workspace_id = ${board.workspace_id}::uuid AND is_archived = false
          ORDER BY name
        `),
        tx.$queryRaw<OptionSetRow[]>(Prisma.sql`
          SELECT id, column_id, name, allow_multiple
          FROM work_board_option_sets_v1
          WHERE tenant_id = ${actor.tenantId}::uuid AND board_id = ${board.id}::uuid
          ORDER BY name
        `),
        tx.$queryRaw<OptionRow[]>(Prisma.sql`
          SELECT o.id, o.option_set_id, o.key, o.label, o.color, o.sort_order, o.is_active
          FROM work_board_options_v1 o
          JOIN work_board_option_sets_v1 s ON s.id = o.option_set_id
          WHERE o.tenant_id = ${actor.tenantId}::uuid AND s.board_id = ${board.id}::uuid
          ORDER BY o.sort_order, o.label
        `),
      ]);

      const optionsBySet = new Map<string, OptionRow[]>();
      for (const option of options) optionsBySet.set(option.option_set_id, [...(optionsBySet.get(option.option_set_id) ?? []), option]);
      return {
        boardId: board.id,
        workspaceId: board.workspace_id,
        people: people.map((row) => ({ ...row.user, workspaceRole: row.role })),
        boards: boards.map((row) => ({ id: row.id, name: row.name, objectDefinitionId: row.object_definition_id })),
        optionSets: optionSets.map((set) => ({
          id: set.id,
          columnId: set.column_id,
          name: set.name,
          allowMultiple: set.allow_multiple,
          options: (optionsBySet.get(set.id) ?? []).map((option) => ({
            id: option.id, key: option.key, label: option.label, color: option.color,
            sortOrder: option.sort_order, isActive: option.is_active,
          })),
        })),
      };
    });
  });

  app.put('/api/v1/work-os/boards-v1/:boardId/columns/:columnId/options', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = boardColumnParams.safeParse(request.params);
    const body = replaceOptionsSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error', details: body.success ? undefined : body.error.flatten() });
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      const board = await getBoard(tx, actor.tenantId, params.data.boardId);
      if (!board) return reply.code(404).send({ error: 'board_not_found' });
      if (!(await canManageWorkspace(tx, actor, board.workspace_id))) return reply.code(403).send({ error: 'workspace_manage_denied' });
      const column = await getColumn(tx, actor.tenantId, board.id, params.data.columnId);
      if (!column) return reply.code(404).send({ error: 'column_not_found' });
      if (!['STATUS', 'PRIORITY', 'TAGS'].includes(column.data_type)) return reply.code(409).send({ error: 'column_does_not_support_options' });

      const normalized = body.data.options.map((option, index) => ({
        key: normalizeBoardKeyV1(option.key), label: option.label, color: option.color ?? null, sortOrder: (index + 1) * 10,
      }));
      if (new Set(normalized.map((item) => item.key)).size !== normalized.length) return reply.code(400).send({ error: 'duplicate_option_key' });

      const setRows = await tx.$queryRaw<OptionSetRow[]>(Prisma.sql`
        INSERT INTO work_board_option_sets_v1 (tenant_id, board_id, column_id, name, allow_multiple)
        VALUES (${actor.tenantId}::uuid, ${board.id}::uuid, ${column.id}::uuid, ${body.data.name ?? column.label}, ${column.data_type === 'TAGS'})
        ON CONFLICT (column_id) DO UPDATE
        SET name = EXCLUDED.name, allow_multiple = EXCLUDED.allow_multiple, updated_at = CURRENT_TIMESTAMP
        RETURNING id, column_id, name, allow_multiple
      `);
      const optionSet = setRows[0]!;
      const activeKeys = normalized.map((item) => item.key);
      await tx.$executeRaw(Prisma.sql`
        UPDATE work_board_options_v1
        SET is_active = false, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${actor.tenantId}::uuid AND option_set_id = ${optionSet.id}::uuid
          AND NOT (key = ANY(${activeKeys}::text[]))
      `);
      for (const option of normalized) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO work_board_options_v1 (tenant_id, option_set_id, key, label, color, sort_order, is_active)
          VALUES (${actor.tenantId}::uuid, ${optionSet.id}::uuid, ${option.key}, ${option.label}, ${option.color}, ${option.sortOrder}, true)
          ON CONFLICT (option_set_id, key) DO UPDATE
          SET label = EXCLUDED.label, color = EXCLUDED.color, sort_order = EXCLUDED.sort_order, is_active = true, updated_at = CURRENT_TIMESTAMP
        `);
      }
      return { id: optionSet.id, columnId: column.id, name: optionSet.name, allowMultiple: optionSet.allow_multiple, options: normalized };
    });
  });

  app.post('/api/v1/work-os/boards-v1/:boardId/relation-columns', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = boardParams.safeParse(request.params);
    const body = createRelationColumnSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      const board = await getBoard(tx, actor.tenantId, params.data.boardId);
      if (!board) return reply.code(404).send({ error: 'board_not_found' });
      if (!(await canManageWorkspace(tx, actor, board.workspace_id))) return reply.code(403).send({ error: 'workspace_manage_denied' });
      if (body.data.targetBoardId === board.id) return reply.code(409).send({ error: 'relation_target_board_must_differ' });
      const target = await getBoard(tx, actor.tenantId, body.data.targetBoardId);
      if (!target || target.workspace_id !== board.workspace_id) return reply.code(409).send({ error: 'relation_target_scope_invalid' });

      const columnId = randomUUID();
      const fieldKey = normalizeBoardKeyV1(body.data.fieldKey);
      const relationType = `BOARD_LINK:${columnId}`;
      const rows = await tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        INSERT INTO work_board_columns_v1
          (id, tenant_id, board_id, key, label, source, data_type, field_key, width, sort_order, is_visible, is_editable, config)
        VALUES
          (${columnId}::uuid, ${actor.tenantId}::uuid, ${board.id}::uuid, ${fieldKey}, ${body.data.label},
           'CUSTOM'::"WorkBoardColumnSourceV1", 'RELATION'::"WorkBoardColumnTypeV1", ${fieldKey}, 220, 500, true, true,
           ${JSON.stringify({ targetBoardId: target.id, relationType, multiple: body.data.multiple })}::jsonb)
        RETURNING id, key, label, source, data_type, field_key, width, sort_order, is_visible, is_editable, config
      `);
      return reply.code(201).send(rows[0]);
    });
  });

  app.post('/api/v1/work-os/boards-v1/:boardId/formula-columns', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = boardParams.safeParse(request.params);
    const body = createFormulaColumnSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error', details: body.success ? undefined : body.error.flatten() });
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      const board = await getBoard(tx, actor.tenantId, params.data.boardId);
      if (!board) return reply.code(404).send({ error: 'board_not_found' });
      if (!(await canManageWorkspace(tx, actor, board.workspace_id))) return reply.code(403).send({ error: 'workspace_manage_denied' });
      const columns = await tx.$queryRaw<Array<{ field_key: string; data_type: string }>>(Prisma.sql`
        SELECT field_key, data_type FROM work_board_columns_v1
        WHERE tenant_id = ${actor.tenantId}::uuid AND board_id = ${board.id}::uuid
      `);
      const numericKeys = new Set(columns.filter((column) => ['NUMBER', 'CURRENCY', 'PROGRESS'].includes(column.data_type)).map((column) => column.field_key));
      numericKeys.add('progress');
      const fieldKey = normalizeBoardKeyV1(body.data.fieldKey);
      try {
        validateBoardFormulaV1(body.data.expression, { formulaFieldKey: fieldKey, allowedFieldKeys: numericKeys });
      } catch (error) {
        if (error instanceof BoardFormulaValidationError) return reply.code(400).send({ error: 'invalid_board_formula', message: error.message });
        throw error;
      }
      const rows = await tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        INSERT INTO work_board_columns_v1
          (tenant_id, board_id, key, label, source, data_type, field_key, width, sort_order, is_visible, is_editable, config)
        VALUES
          (${actor.tenantId}::uuid, ${board.id}::uuid, ${fieldKey}, ${body.data.label},
           'CUSTOM'::"WorkBoardColumnSourceV1", 'FORMULA'::"WorkBoardColumnTypeV1", ${fieldKey}, 160, 500, true, false,
           ${JSON.stringify({ formula: body.data.expression, format: body.data.format, decimals: body.data.decimals, currency: body.data.currency ?? null })}::jsonb)
        RETURNING id, key, label, source, data_type, field_key, width, sort_order, is_visible, is_editable, config
      `);
      return reply.code(201).send(rows[0]);
    });
  });

  app.get('/api/v1/work-os/boards-v1/:boardId/columns/:columnId/relation-candidates', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = boardColumnParams.safeParse(request.params);
    const query = relationCandidatesQuery.safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      const board = await getBoard(tx, actor.tenantId, params.data.boardId);
      if (!board) return reply.code(404).send({ error: 'board_not_found' });
      if (!(await canAccessWorkspace(tx, actor, board.workspace_id))) return reply.code(403).send({ error: 'workspace_access_denied' });
      const column = await getColumn(tx, actor.tenantId, board.id, params.data.columnId);
      if (!column || column.data_type !== 'RELATION') return reply.code(404).send({ error: 'relation_column_not_found' });
      const config = asFormulaConfig(column);
      if (!config.targetBoardId) return reply.code(409).send({ error: 'relation_column_not_configured' });
      const rows = await tx.$queryRaw<Array<{ id: string; title: string; status: string; object_type_key: string }>>(Prisma.sql`
        SELECT o.id, o.title, o.status, o.object_type_key
        FROM work_board_item_placements_v1 p
        JOIN nexus_objects o ON o.id = p.object_id AND o.deleted_at IS NULL
        WHERE p.tenant_id = ${actor.tenantId}::uuid AND p.board_id = ${config.targetBoardId}::uuid
          AND (${query.data.search ?? null}::text IS NULL OR o.title ILIKE '%' || ${query.data.search ?? null} || '%')
        ORDER BY o.title
        LIMIT ${query.data.limit}
      `);
      return { items: rows.map((row) => ({ id: row.id, title: row.title, status: row.status, objectTypeKey: row.object_type_key })) };
    });
  });

  app.put('/api/v1/work-os/boards-v1/:boardId/items/:objectId/relations/:columnId', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = boardObjectColumnParams.safeParse(request.params);
    const body = relationCellSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      const board = await getBoard(tx, actor.tenantId, params.data.boardId);
      if (!board) return reply.code(404).send({ error: 'board_not_found' });
      if (!(await canManageWorkspace(tx, actor, board.workspace_id))) return reply.code(403).send({ error: 'workspace_manage_denied' });
      const source = await assertPlacedObject(tx, actor.tenantId, board, params.data.objectId);
      if (!source) return reply.code(404).send({ error: 'board_item_not_found' });
      const column = await getColumn(tx, actor.tenantId, board.id, params.data.columnId);
      if (!column || column.data_type !== 'RELATION' || !column.is_editable) return reply.code(409).send({ error: 'relation_column_not_editable' });
      const config = asFormulaConfig(column);
      if (!config.targetBoardId || !config.relationType) return reply.code(409).send({ error: 'relation_column_not_configured' });
      if (!config.multiple && body.data.targetObjectIds.length > 1) return reply.code(400).send({ error: 'relation_allows_one_target' });
      const uniqueTargets = [...new Set(body.data.targetObjectIds)];
      if (uniqueTargets.length !== body.data.targetObjectIds.length) return reply.code(400).send({ error: 'duplicate_relation_target' });
      if (uniqueTargets.includes(source.id)) return reply.code(409).send({ error: 'self_relation_not_allowed' });

      if (uniqueTargets.length) {
        const valid = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT o.id
          FROM work_board_item_placements_v1 p
          JOIN nexus_objects o ON o.id = p.object_id AND o.deleted_at IS NULL
          WHERE p.tenant_id = ${actor.tenantId}::uuid AND p.board_id = ${config.targetBoardId}::uuid
            AND o.id = ANY(${uniqueTargets}::uuid[])
        `);
        if (valid.length !== uniqueTargets.length) return reply.code(409).send({ error: 'relation_target_not_in_target_board' });
      }

      const updated = await tx.nexusObject.updateMany({
        where: { id: source.id, tenantId: actor.tenantId, version: body.data.version, deletedAt: null },
        data: { version: { increment: 1 } },
      });
      if (updated.count !== 1) return reply.code(409).send({ error: 'version_conflict' });

      await tx.objectRelation.deleteMany({
        where: { tenantId: actor.tenantId, sourceObjectId: source.id, relationType: config.relationType },
      });
      for (const targetObjectId of uniqueTargets) {
        await tx.objectRelation.create({
          data: {
            tenantId: actor.tenantId,
            sourceObjectId: source.id,
            targetObjectId,
            relationType: config.relationType,
            metadata: { boardColumnId: column.id, sourceBoardId: board.id, targetBoardId: config.targetBoardId },
          },
        });
      }
      await tx.auditLog.create({ data: {
        tenantId: actor.tenantId, userId: actor.userId, action: 'BOARD_RELATION_CELL_UPDATED', resource: 'NEXUS_OBJECT',
        resourceId: source.id, correlationId: request.id, ipAddress: request.ip,
        details: { boardId: board.id, columnId: column.id, targetObjectIds: uniqueTargets },
      } });
      return { objectId: source.id, version: body.data.version + 1, targetObjectIds: uniqueTargets };
    });
  });

  app.patch('/api/v1/work-os/boards-v1/:boardId/items/:objectId/person-cells/:columnId', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = boardObjectColumnParams.safeParse(request.params);
    const body = personCellSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      const board = await getBoard(tx, actor.tenantId, params.data.boardId);
      if (!board) return reply.code(404).send({ error: 'board_not_found' });
      if (!(await canManageWorkspace(tx, actor, board.workspace_id))) return reply.code(403).send({ error: 'workspace_manage_denied' });
      const source = await assertPlacedObject(tx, actor.tenantId, board, params.data.objectId);
      if (!source) return reply.code(404).send({ error: 'board_item_not_found' });
      const column = await getColumn(tx, actor.tenantId, board.id, params.data.columnId);
      if (!column || column.data_type !== 'PERSON' || !column.is_editable) return reply.code(409).send({ error: 'person_column_not_editable' });

      if (body.data.userId) {
        const member = await tx.workspaceMember.findFirst({
          where: {
            tenantId: actor.tenantId, workspaceId: board.workspace_id, userId: body.data.userId,
            user: { isActive: true, tenantMemberships: { some: { tenantId: actor.tenantId, status: 'ACTIVE' } } },
          },
          select: { userId: true },
        });
        if (!member) return reply.code(409).send({ error: 'person_not_workspace_member' });
      }

      const updated = await tx.nexusObject.updateMany({
        where: { id: source.id, tenantId: actor.tenantId, version: body.data.version, deletedAt: null },
        data: column.source === 'CORE' && column.field_key === 'assigneeId'
          ? { assigneeId: body.data.userId, version: { increment: 1 } }
          : { version: { increment: 1 } },
      });
      if (updated.count !== 1) return reply.code(409).send({ error: 'version_conflict' });
      if (column.source === 'CUSTOM') {
        if (body.data.userId === null) {
          await tx.objectFieldValue.deleteMany({ where: { tenantId: actor.tenantId, objectId: source.id, fieldKey: column.field_key } });
        } else {
          await tx.objectFieldValue.upsert({
            where: { objectId_fieldKey: { objectId: source.id, fieldKey: column.field_key } },
            create: { tenantId: actor.tenantId, objectId: source.id, fieldKey: column.field_key, valueText: body.data.userId },
            update: { valueText: body.data.userId, valueNumber: null, valueDate: null, valueBoolean: null, valueJson: Prisma.DbNull },
          });
        }
      } else if (column.field_key !== 'assigneeId') {
        return reply.code(409).send({ error: 'unsupported_core_person_field' });
      }
      return { objectId: source.id, version: body.data.version + 1, userId: body.data.userId };
    });
  });
}
