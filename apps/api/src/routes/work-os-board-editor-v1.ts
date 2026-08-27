import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canAccessWorkspace, canManageWorkspace } from '../authorization.js';
import { validateViewConfigV1, WorkBoardValidationError } from '../domain/board-view-v1.js';
import { withTenant } from '../tenant-transaction.js';

const uuid = z.string().uuid();
const boardParams = z.object({ boardId: uuid });
const boardColumnParams = z.object({ boardId: uuid, columnId: uuid });
const boardViewParams = z.object({ boardId: uuid, viewId: uuid });
const boardGroupParams = z.object({ boardId: uuid, groupId: uuid });
const boardObjectParams = z.object({ boardId: uuid, objectId: uuid });
const boardCellParams = z.object({ boardId: uuid, objectId: uuid, columnId: uuid });

const availableQuery = z.object({
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const patchColumnSchema = z.object({
  label: z.string().trim().min(1).max(255).optional(),
  width: z.number().int().min(60).max(600).nullable().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  isVisible: z.boolean().optional(),
  isEditable: z.boolean().optional(),
  config: z.record(z.unknown()).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'At least one column setting is required.' });

const patchViewSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  config: z.record(z.unknown()).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'At least one view setting is required.' });

const patchGroupSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  color: z.string().trim().max(30).nullable().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'At least one group setting is required.' });

const batchPlacementSchema = z.object({
  items: z.array(z.object({
    objectId: uuid,
    groupId: uuid.nullable(),
    sortOrder: z.number().int().min(0).max(1000000),
  })).min(1).max(500),
});

const cellSchema = z.object({
  version: z.number().int().positive(),
  value: z.unknown(),
});

type BoardRow = {
  id: string;
  workspace_id: string;
  object_definition_id: string;
};

type ColumnRow = {
  id: string;
  source: 'CORE' | 'CUSTOM';
  data_type: string;
  field_key: string;
  is_visible: boolean;
  is_editable: boolean;
};

type ViewRow = {
  id: string;
  view_type: 'TABLE' | 'KANBAN' | 'CALENDAR' | 'GANTT' | 'TIMELINE';
  config: Record<string, unknown> | null;
};

async function getBoard(tx: Prisma.TransactionClient, tenantId: string, boardId: string): Promise<BoardRow | null> {
  const rows = await tx.$queryRaw<BoardRow[]>(Prisma.sql`
    SELECT id, workspace_id, object_definition_id
    FROM work_boards_v1
    WHERE tenant_id = ${tenantId}::uuid AND id = ${boardId}::uuid AND is_archived = false
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function getColumn(tx: Prisma.TransactionClient, tenantId: string, boardId: string, columnId: string): Promise<ColumnRow | null> {
  const rows = await tx.$queryRaw<ColumnRow[]>(Prisma.sql`
    SELECT id, source, data_type, field_key, is_visible, is_editable
    FROM work_board_columns_v1
    WHERE tenant_id = ${tenantId}::uuid AND board_id = ${boardId}::uuid AND id = ${columnId}::uuid
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function getView(tx: Prisma.TransactionClient, tenantId: string, boardId: string, viewId: string): Promise<ViewRow | null> {
  const rows = await tx.$queryRaw<ViewRow[]>(Prisma.sql`
    SELECT id, view_type, config
    FROM work_views_v1
    WHERE tenant_id = ${tenantId}::uuid AND board_id = ${boardId}::uuid AND id = ${viewId}::uuid
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function assertBoardItem(
  tx: Prisma.TransactionClient,
  tenantId: string,
  board: BoardRow,
  objectId: string,
) {
  const placement = await tx.$queryRaw<{ exists: boolean }[]>(Prisma.sql`
    SELECT EXISTS(
      SELECT 1 FROM work_board_item_placements_v1
      WHERE tenant_id = ${tenantId}::uuid AND board_id = ${board.id}::uuid AND object_id = ${objectId}::uuid
    ) AS exists
  `);
  if (!placement[0]?.exists) return null;
  return tx.nexusObject.findFirst({
    where: {
      id: objectId,
      tenantId,
      workspaceId: board.workspace_id,
      objectDefinitionId: board.object_definition_id,
      deletedAt: null,
    },
    select: { id: true, version: true },
  });
}

function parseDateValue(value: unknown): Date | null {
  if (value === null || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new WorkBoardValidationError('Invalid date value.');
  return date;
}

function stringValue(value: unknown, options: { nullable?: boolean; max?: number } = {}): string | null {
  if ((value === null || value === '') && options.nullable) return null;
  if (typeof value !== 'string') throw new WorkBoardValidationError('Expected a text value.');
  const trimmed = value.trim();
  if (!trimmed && !options.nullable) throw new WorkBoardValidationError('Text value cannot be empty.');
  if (options.max && trimmed.length > options.max) throw new WorkBoardValidationError(`Text value exceeds ${options.max} characters.`);
  return trimmed || null;
}

function normalizeCustomValue(dataType: string, value: unknown): {
  valueText?: string | null;
  valueNumber?: Prisma.Decimal | null;
  valueDate?: Date | null;
  valueBoolean?: boolean | null;
  valueJson?: Prisma.InputJsonValue;
} | null {
  if (value === null || value === '') return null;
  switch (dataType) {
    case 'NUMBER':
    case 'CURRENCY': {
      const number = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(number)) throw new WorkBoardValidationError('Expected a finite number.');
      return { valueNumber: new Prisma.Decimal(number) };
    }
    case 'DATE':
      return { valueDate: parseDateValue(value) };
    case 'BOOLEAN':
      if (typeof value !== 'boolean') throw new WorkBoardValidationError('Expected a boolean value.');
      return { valueBoolean: value };
    case 'TAGS':
    case 'FILE':
      if (!Array.isArray(value)) throw new WorkBoardValidationError(`${dataType} values must be arrays.`);
      return { valueJson: value as Prisma.InputJsonValue };
    case 'PERSON':
      if (typeof value !== 'string' || !z.string().uuid().safeParse(value).success) {
        throw new WorkBoardValidationError('PERSON values must be a user UUID.');
      }
      return { valueText: value };
    case 'TEXT':
    case 'LONG_TEXT':
    case 'STATUS':
    case 'PRIORITY':
    case 'LINK':
      return { valueText: stringValue(value, { nullable: false, max: dataType === 'LONG_TEXT' ? 20000 : 500 }) };
    case 'PROGRESS': {
      const number = Number(value);
      if (!Number.isInteger(number) || number < 0 || number > 100) throw new WorkBoardValidationError('Progress must be an integer from 0 to 100.');
      return { valueNumber: new Prisma.Decimal(number) };
    }
    case 'FORMULA':
      throw new WorkBoardValidationError('Formula columns are read-only.');
    default:
      throw new WorkBoardValidationError(`Unsupported custom column type: ${dataType}`);
  }
}

async function validateActiveUser(tx: Prisma.TransactionClient, tenantId: string, userId: string): Promise<boolean> {
  const row = await tx.tenantMembership.findUnique({
    where: { tenantId_userId: { tenantId, userId } },
    include: { user: { select: { isActive: true } } },
  });
  return row?.status === 'ACTIVE' && row.user.isActive;
}

export async function workOsBoardEditorV1Routes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/work-os/boards-v1/:boardId/available-items', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = boardParams.safeParse(request.params);
    const query = availableQuery.safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      const board = await getBoard(tx, actor.tenantId, params.data.boardId);
      if (!board) return reply.code(404).send({ error: 'board_not_found' });
      if (!(await canAccessWorkspace(tx, actor, board.workspace_id))) return reply.code(403).send({ error: 'workspace_access_denied' });
      const placed = await tx.$queryRaw<{ object_id: string }[]>(Prisma.sql`
        SELECT object_id FROM work_board_item_placements_v1
        WHERE tenant_id = ${actor.tenantId}::uuid AND board_id = ${board.id}::uuid
      `);
      const excludedIds = placed.map((item) => item.object_id);
      const items = await tx.nexusObject.findMany({
        where: {
          tenantId: actor.tenantId,
          workspaceId: board.workspace_id,
          objectDefinitionId: board.object_definition_id,
          deletedAt: null,
          ...(excludedIds.length ? { id: { notIn: excludedIds } } : {}),
          ...(query.data.search ? { title: { contains: query.data.search, mode: 'insensitive' } } : {}),
        },
        take: query.data.limit,
        orderBy: [{ updatedAt: 'desc' }, { title: 'asc' }],
        select: {
          id: true, title: true, status: true, priority: true, progress: true, version: true,
          assignee: { select: { id: true, fullName: true, avatarUrl: true } },
        },
      });
      return { items };
    });
  });

  app.patch('/api/v1/work-os/boards-v1/:boardId/columns/:columnId', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = boardColumnParams.safeParse(request.params);
    const body = patchColumnSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error', details: body.success ? undefined : body.error.flatten() });
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      const board = await getBoard(tx, actor.tenantId, params.data.boardId);
      if (!board) return reply.code(404).send({ error: 'board_not_found' });
      if (!(await canManageWorkspace(tx, actor, board.workspace_id))) return reply.code(403).send({ error: 'workspace_manage_denied' });
      const column = await getColumn(tx, actor.tenantId, board.id, params.data.columnId);
      if (!column) return reply.code(404).send({ error: 'column_not_found' });
      if (column.field_key === 'title' && body.data.isVisible === false) return reply.code(409).send({ error: 'title_column_must_remain_visible' });
      if (['ownerId', 'createdAt', 'updatedAt'].includes(column.field_key) && body.data.isEditable === true) {
        return reply.code(409).send({ error: 'core_field_read_only' });
      }
      const rows = await tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        UPDATE work_board_columns_v1
        SET label = COALESCE(${body.data.label ?? null}, label),
            width = CASE WHEN ${body.data.width !== undefined} THEN ${body.data.width ?? null} ELSE width END,
            sort_order = COALESCE(${body.data.sortOrder ?? null}, sort_order),
            is_visible = COALESCE(${body.data.isVisible ?? null}, is_visible),
            is_editable = COALESCE(${body.data.isEditable ?? null}, is_editable),
            config = CASE WHEN ${body.data.config !== undefined} THEN ${JSON.stringify(body.data.config ?? {})}::jsonb ELSE config END,
            updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${actor.tenantId}::uuid AND board_id = ${board.id}::uuid AND id = ${column.id}::uuid
        RETURNING id, key, label, source, data_type, field_key, width, sort_order, is_visible, is_editable, config
      `);
      return rows[0];
    });
  });

  app.patch('/api/v1/work-os/boards-v1/:boardId/views/:viewId', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = boardViewParams.safeParse(request.params);
    const body = patchViewSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      const board = await getBoard(tx, actor.tenantId, params.data.boardId);
      if (!board) return reply.code(404).send({ error: 'board_not_found' });
      if (!(await canManageWorkspace(tx, actor, board.workspace_id))) return reply.code(403).send({ error: 'workspace_manage_denied' });
      const current = await getView(tx, actor.tenantId, board.id, params.data.viewId);
      if (!current) return reply.code(404).send({ error: 'view_not_found' });
      const config = { ...(current.config ?? {}), ...(body.data.config ?? {}) };
      try { validateViewConfigV1(current.view_type, config); } catch (error) {
        if (error instanceof WorkBoardValidationError) return reply.code(400).send({ error: 'invalid_work_view', message: error.message });
        throw error;
      }
      if (body.data.isDefault) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE work_views_v1 SET is_default = false
          WHERE tenant_id = ${actor.tenantId}::uuid AND board_id = ${board.id}::uuid
        `);
      }
      const rows = await tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        UPDATE work_views_v1
        SET name = COALESCE(${body.data.name ?? null}, name),
            is_default = COALESCE(${body.data.isDefault ?? null}, is_default),
            sort_order = COALESCE(${body.data.sortOrder ?? null}, sort_order),
            config = ${JSON.stringify(config)}::jsonb,
            updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${actor.tenantId}::uuid AND board_id = ${board.id}::uuid AND id = ${current.id}::uuid
        RETURNING id, name, view_type, is_default, sort_order, config
      `);
      return rows[0];
    });
  });

  app.patch('/api/v1/work-os/boards-v1/:boardId/groups/:groupId', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = boardGroupParams.safeParse(request.params);
    const body = patchGroupSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      const board = await getBoard(tx, actor.tenantId, params.data.boardId);
      if (!board) return reply.code(404).send({ error: 'board_not_found' });
      if (!(await canManageWorkspace(tx, actor, board.workspace_id))) return reply.code(403).send({ error: 'workspace_manage_denied' });
      const rows = await tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        UPDATE work_board_groups_v1
        SET name = COALESCE(${body.data.name ?? null}, name),
            color = CASE WHEN ${body.data.color !== undefined} THEN ${body.data.color ?? null} ELSE color END,
            sort_order = COALESCE(${body.data.sortOrder ?? null}, sort_order),
            updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${actor.tenantId}::uuid AND board_id = ${board.id}::uuid AND id = ${params.data.groupId}::uuid
        RETURNING id, key, name, color, sort_order
      `);
      if (!rows[0]) return reply.code(404).send({ error: 'group_not_found' });
      return rows[0];
    });
  });

  app.put('/api/v1/work-os/boards-v1/:boardId/placements', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = boardParams.safeParse(request.params);
    const body = batchPlacementSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      const board = await getBoard(tx, actor.tenantId, params.data.boardId);
      if (!board) return reply.code(404).send({ error: 'board_not_found' });
      if (!(await canManageWorkspace(tx, actor, board.workspace_id))) return reply.code(403).send({ error: 'workspace_manage_denied' });
      for (const item of body.data.items) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO work_board_item_placements_v1 (tenant_id, board_id, object_id, group_id, sort_order)
          VALUES (${actor.tenantId}::uuid, ${board.id}::uuid, ${item.objectId}::uuid, ${item.groupId}::uuid, ${item.sortOrder})
          ON CONFLICT (board_id, object_id)
          DO UPDATE SET group_id = EXCLUDED.group_id, sort_order = EXCLUDED.sort_order, updated_at = CURRENT_TIMESTAMP
        `);
      }
      await tx.auditLog.create({ data: {
        tenantId: actor.tenantId, userId: actor.userId, action: 'WORK_BOARD_ITEMS_REORDERED', resource: 'WORK_BOARD_V1',
        resourceId: board.id, correlationId: request.id, ipAddress: request.ip,
        details: { itemCount: body.data.items.length },
      } });
      return reply.code(204).send();
    });
  });

  app.delete('/api/v1/work-os/boards-v1/:boardId/items/:objectId', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = boardObjectParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      const board = await getBoard(tx, actor.tenantId, params.data.boardId);
      if (!board) return reply.code(404).send({ error: 'board_not_found' });
      if (!(await canManageWorkspace(tx, actor, board.workspace_id))) return reply.code(403).send({ error: 'workspace_manage_denied' });
      const changed = await tx.$executeRaw(Prisma.sql`
        DELETE FROM work_board_item_placements_v1
        WHERE tenant_id = ${actor.tenantId}::uuid AND board_id = ${board.id}::uuid AND object_id = ${params.data.objectId}::uuid
      `);
      if (changed !== 1) return reply.code(404).send({ error: 'board_item_not_found' });
      return reply.code(204).send();
    });
  });

  app.patch('/api/v1/work-os/boards-v1/:boardId/items/:objectId/cells/:columnId', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = boardCellParams.safeParse(request.params);
    const body = cellSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;
    try {
      return await withTenant(actor.tenantId, async (tx) => {
        const board = await getBoard(tx, actor.tenantId, params.data.boardId);
        if (!board) return reply.code(404).send({ error: 'board_not_found' });
        if (!(await canManageWorkspace(tx, actor, board.workspace_id))) return reply.code(403).send({ error: 'workspace_manage_denied' });
        const column = await getColumn(tx, actor.tenantId, board.id, params.data.columnId);
        if (!column) return reply.code(404).send({ error: 'column_not_found' });
        if (!column.is_editable) return reply.code(409).send({ error: 'column_read_only' });
        const object = await assertBoardItem(tx, actor.tenantId, board, params.data.objectId);
        if (!object) return reply.code(404).send({ error: 'board_item_not_found' });
        if (object.version !== body.data.version) return reply.code(409).send({ error: 'version_conflict' });

        if (column.source === 'CORE') {
          const data: Prisma.NexusObjectUpdateManyMutationInput = { version: { increment: 1 } };
          switch (column.field_key) {
            case 'title': data.title = stringValue(body.data.value, { max: 500 })!; break;
            case 'description': data.description = stringValue(body.data.value, { nullable: true, max: 20000 }); break;
            case 'status': data.status = stringValue(body.data.value, { max: 100 })!; break;
            case 'priority': data.priority = stringValue(body.data.value, { max: 50 })!; break;
            case 'progress': {
              const progress = Number(body.data.value);
              if (!Number.isInteger(progress) || progress < 0 || progress > 100) throw new WorkBoardValidationError('Progress must be an integer from 0 to 100.');
              data.progress = progress;
              break;
            }
            case 'assigneeId': {
              if (body.data.value === null || body.data.value === '') data.assigneeId = null;
              else {
                const userId = String(body.data.value);
                if (!uuid.safeParse(userId).success || !(await validateActiveUser(tx, actor.tenantId, userId))) {
                  throw new WorkBoardValidationError('Assignee must be an active tenant user.');
                }
                data.assigneeId = userId;
              }
              break;
            }
            case 'startDate': data.startDate = parseDateValue(body.data.value); break;
            case 'dueDate': data.dueDate = parseDateValue(body.data.value); break;
            default: return reply.code(409).send({ error: 'core_field_read_only' });
          }
          const changed = await tx.nexusObject.updateMany({
            where: { id: object.id, tenantId: actor.tenantId, version: body.data.version, deletedAt: null },
            data,
          });
          if (changed.count !== 1) return reply.code(409).send({ error: 'version_conflict' });
        } else {
          const changed = await tx.nexusObject.updateMany({
            where: { id: object.id, tenantId: actor.tenantId, version: body.data.version, deletedAt: null },
            data: { version: { increment: 1 } },
          });
          if (changed.count !== 1) return reply.code(409).send({ error: 'version_conflict' });
          const normalized = normalizeCustomValue(column.data_type, body.data.value);
          if (!normalized) {
            await tx.objectFieldValue.deleteMany({ where: { objectId: object.id, fieldKey: column.field_key, tenantId: actor.tenantId } });
          } else {
            if (column.data_type === 'PERSON' && normalized.valueText && !(await validateActiveUser(tx, actor.tenantId, normalized.valueText))) {
              throw new WorkBoardValidationError('Custom PERSON must reference an active tenant user.');
            }
            await tx.objectFieldValue.upsert({
              where: { objectId_fieldKey: { objectId: object.id, fieldKey: column.field_key } },
              create: { tenantId: actor.tenantId, objectId: object.id, fieldKey: column.field_key, ...normalized },
              update: {
                valueText: null, valueNumber: null, valueDate: null, valueBoolean: null, valueJson: Prisma.DbNull,
                ...normalized,
              },
            });
          }
        }

        const nextVersion = body.data.version + 1;
        await Promise.all([
          tx.domainEvent.create({ data: {
            tenantId: actor.tenantId, aggregateId: object.id, eventType: 'bridata.work_board.cell.updated',
            payload: { boardId: board.id, objectId: object.id, columnId: column.id, fieldKey: column.field_key, source: column.source, version: nextVersion },
          } }),
          tx.auditLog.create({ data: {
            tenantId: actor.tenantId, userId: actor.userId, action: 'WORK_BOARD_CELL_UPDATED', resource: 'NEXUS_OBJECT',
            resourceId: object.id, correlationId: request.id, ipAddress: request.ip,
            details: { boardId: board.id, columnId: column.id, fieldKey: column.field_key, source: column.source, version: nextVersion },
          } }),
        ]);
        return { objectId: object.id, version: nextVersion };
      });
    } catch (error) {
      if (error instanceof WorkBoardValidationError) return reply.code(400).send({ error: 'invalid_cell_value', message: error.message });
      throw error;
    }
  });
}
