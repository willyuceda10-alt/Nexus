import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canAccessWorkspace, canManageWorkspace } from '../authorization.js';
import {
  normalizeBoardKeyV1,
  validateBoardColumnV1,
  validateViewConfigV1,
  WorkBoardValidationError,
} from '../domain/board-view-v1.js';
import { withTenant } from '../tenant-transaction.js';

const id = z.string().uuid();
const listSchema = z.object({ workspaceId: id });
const boardParamsSchema = z.object({ boardId: id });
const boardObjectParamsSchema = z.object({ boardId: id, objectId: id });
const dataQuerySchema = z.object({ viewId: id.optional() });

const createBoardSchema = z.object({
  workspaceId: id,
  objectDefinitionId: id,
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(5000).nullable().optional(),
  icon: z.string().trim().max(100).nullable().optional(),
});

const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(255),
  key: z.string().trim().min(1).max(100).optional(),
  color: z.string().trim().max(30).nullable().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});

const columnSource = z.enum(['CORE', 'CUSTOM']);
const columnType = z.enum([
  'TEXT', 'LONG_TEXT', 'NUMBER', 'CURRENCY', 'DATE', 'BOOLEAN', 'STATUS',
  'PRIORITY', 'PROGRESS', 'PERSON', 'TAGS', 'LINK', 'FILE', 'FORMULA',
]);
const createColumnSchema = z.object({
  label: z.string().trim().min(1).max(255),
  key: z.string().trim().min(1).max(100).optional(),
  source: columnSource,
  dataType: columnType,
  fieldKey: z.string().trim().min(1).max(100),
  width: z.number().int().min(60).max(600).nullable().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  isVisible: z.boolean().optional(),
  isEditable: z.boolean().optional(),
  config: z.record(z.unknown()).nullable().optional(),
});

const viewType = z.enum(['TABLE', 'KANBAN', 'CALENDAR', 'GANTT', 'TIMELINE']);
const createViewSchema = z.object({
  name: z.string().trim().min(1).max(255),
  viewType,
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  config: z.record(z.unknown()).default({}),
});

const placeItemSchema = z.object({
  objectId: id,
  groupId: id.nullable().optional(),
  sortOrder: z.number().int().min(0).max(1000000).optional(),
});
const updatePlacementSchema = z.object({
  groupId: id.nullable().optional(),
  sortOrder: z.number().int().min(0).max(1000000).optional(),
}).refine((value) => value.groupId !== undefined || value.sortOrder !== undefined, {
  message: 'At least one placement field is required.',
});

type BoardRow = {
  id: string;
  workspace_id: string;
  object_definition_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  is_archived: boolean;
  created_at: Date;
  updated_at: Date;
};
type GroupRow = { id: string; key: string; name: string; color: string | null; sort_order: number };
type ColumnRow = {
  id: string; key: string; label: string; source: string; data_type: string; field_key: string;
  width: number | null; sort_order: number; is_visible: boolean; is_editable: boolean; config: unknown;
};
type ViewRow = { id: string; name: string; view_type: string; is_default: boolean; sort_order: number; config: unknown };
type PlacementRow = { object_id: string; group_id: string | null; sort_order: number };

async function loadBoard(tx: Prisma.TransactionClient, tenantId: string, boardId: string): Promise<BoardRow | null> {
  const rows = await tx.$queryRaw<BoardRow[]>(Prisma.sql`
    SELECT id, workspace_id, object_definition_id, name, description, icon, is_archived, created_at, updated_at
    FROM work_boards_v1
    WHERE tenant_id = ${tenantId}::uuid AND id = ${boardId}::uuid
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function loadBoardConfig(tx: Prisma.TransactionClient, tenantId: string, boardId: string) {
  const [groups, columns, views] = await Promise.all([
    tx.$queryRaw<GroupRow[]>(Prisma.sql`
      SELECT id, key, name, color, sort_order FROM work_board_groups_v1
      WHERE tenant_id = ${tenantId}::uuid AND board_id = ${boardId}::uuid ORDER BY sort_order, id
    `),
    tx.$queryRaw<ColumnRow[]>(Prisma.sql`
      SELECT id, key, label, source, data_type, field_key, width, sort_order, is_visible, is_editable, config
      FROM work_board_columns_v1
      WHERE tenant_id = ${tenantId}::uuid AND board_id = ${boardId}::uuid ORDER BY sort_order, id
    `),
    tx.$queryRaw<ViewRow[]>(Prisma.sql`
      SELECT id, name, view_type, is_default, sort_order, config FROM work_views_v1
      WHERE tenant_id = ${tenantId}::uuid AND board_id = ${boardId}::uuid ORDER BY sort_order, id
    `),
  ]);
  return { groups, columns, views };
}

function serializeBoard(board: BoardRow) {
  return {
    id: board.id,
    workspaceId: board.workspace_id,
    objectDefinitionId: board.object_definition_id,
    name: board.name,
    description: board.description,
    icon: board.icon,
    isArchived: board.is_archived,
    createdAt: board.created_at,
    updatedAt: board.updated_at,
  };
}

export async function workOsBoardsV1Routes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/work-os/boards-v1', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const parsed = listSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() });
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      if (!(await canAccessWorkspace(tx, actor, parsed.data.workspaceId))) return reply.code(403).send({ error: 'workspace_access_denied' });
      const rows = await tx.$queryRaw<BoardRow[]>(Prisma.sql`
        SELECT id, workspace_id, object_definition_id, name, description, icon, is_archived, created_at, updated_at
        FROM work_boards_v1
        WHERE tenant_id = ${actor.tenantId}::uuid
          AND workspace_id = ${parsed.data.workspaceId}::uuid
          AND is_archived = false
        ORDER BY updated_at DESC, name
      `);
      return { items: rows.map(serializeBoard) };
    });
  });

  app.post('/api/v1/work-os/boards-v1', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const parsed = createBoardSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() });
    const actor = request.actor!;
    const data = parsed.data;
    const result = await withTenant(actor.tenantId, async (tx) => {
      if (!(await canManageWorkspace(tx, actor, data.workspaceId))) return { kind: 'forbidden' as const };
      const definition = await tx.objectDefinition.findFirst({
        where: { id: data.objectDefinitionId, tenantId: actor.tenantId }, select: { id: true, key: true, name: true },
      });
      if (!definition) return { kind: 'definition_not_found' as const };

      const boardRows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO work_boards_v1
          (tenant_id, workspace_id, object_definition_id, name, description, icon, created_by_user_id)
        VALUES
          (${actor.tenantId}::uuid, ${data.workspaceId}::uuid, ${data.objectDefinitionId}::uuid,
           ${data.name}, ${data.description ?? null}, ${data.icon ?? null}, ${actor.userId}::uuid)
        RETURNING id
      `);
      const boardId = boardRows[0]!.id;

      const defaultGroups = [
        { key: 'pendiente', name: 'Pendiente', color: '#94a3b8', sort: 10 },
        { key: 'en_curso', name: 'En curso', color: '#16a34a', sort: 20 },
        { key: 'completado', name: 'Completado', color: '#059669', sort: 30 },
      ];
      for (const group of defaultGroups) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO work_board_groups_v1 (tenant_id, board_id, key, name, color, sort_order)
          VALUES (${actor.tenantId}::uuid, ${boardId}::uuid, ${group.key}, ${group.name}, ${group.color}, ${group.sort})
        `);
      }

      const defaults = [
        { key: 'titulo', label: 'Elemento', source: 'CORE', type: 'TEXT', fieldKey: 'title', width: 320, sort: 10, editable: true },
        { key: 'estado', label: 'Estado', source: 'CORE', type: 'STATUS', fieldKey: 'status', width: 150, sort: 20, editable: true },
        { key: 'responsable', label: 'Responsable', source: 'CORE', type: 'PERSON', fieldKey: 'assigneeId', width: 180, sort: 30, editable: true },
        { key: 'fecha_fin', label: 'Fecha objetivo', source: 'CORE', type: 'DATE', fieldKey: 'dueDate', width: 150, sort: 40, editable: true },
        { key: 'avance', label: 'Avance', source: 'CORE', type: 'PROGRESS', fieldKey: 'progress', width: 120, sort: 50, editable: true },
      ];
      for (const column of defaults) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO work_board_columns_v1
            (tenant_id, board_id, key, label, source, data_type, field_key, width, sort_order, is_visible, is_editable)
          VALUES
            (${actor.tenantId}::uuid, ${boardId}::uuid, ${column.key}, ${column.label},
             ${column.source}::"WorkBoardColumnSourceV1", ${column.type}::"WorkBoardColumnTypeV1", ${column.fieldKey},
             ${column.width}, ${column.sort}, true, ${column.editable})
        `);
      }

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO work_views_v1 (tenant_id, board_id, name, view_type, is_default, sort_order, config)
        VALUES
          (${actor.tenantId}::uuid, ${boardId}::uuid, 'Tabla principal', 'TABLE'::"WorkViewTypeV1", true, 10, '{"density":"comfortable"}'::jsonb),
          (${actor.tenantId}::uuid, ${boardId}::uuid, 'Kanban', 'KANBAN'::"WorkViewTypeV1", false, 20, '{"kanbanColumnKey":"status"}'::jsonb)
      `);

      await Promise.all([
        tx.domainEvent.create({ data: {
          tenantId: actor.tenantId, aggregateId: boardId, eventType: 'bridata.work_board.created',
          payload: { boardId, workspaceId: data.workspaceId, objectDefinitionId: definition.id, objectTypeKey: definition.key },
        } }),
        tx.auditLog.create({ data: {
          tenantId: actor.tenantId, userId: actor.userId, action: 'WORK_BOARD_CREATED', resource: 'WORK_BOARD_V1',
          resourceId: boardId, correlationId: request.id, ipAddress: request.ip,
          details: { workspaceId: data.workspaceId, objectDefinitionId: definition.id, objectTypeKey: definition.key },
        } }),
      ]);
      return { kind: 'created' as const, boardId };
    });
    if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_manage_denied' });
    if (result.kind === 'definition_not_found') return reply.code(404).send({ error: 'object_definition_not_found' });
    return reply.code(201).send({ id: result.boardId });
  });

  app.get('/api/v1/work-os/boards-v1/:boardId', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = boardParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      const board = await loadBoard(tx, actor.tenantId, params.data.boardId);
      if (!board) return reply.code(404).send({ error: 'board_not_found' });
      if (!(await canAccessWorkspace(tx, actor, board.workspace_id))) return reply.code(403).send({ error: 'workspace_access_denied' });
      const config = await loadBoardConfig(tx, actor.tenantId, board.id);
      return { ...serializeBoard(board), ...config };
    });
  });

  app.get('/api/v1/work-os/boards-v1/:boardId/data', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = boardParamsSchema.safeParse(request.params);
    const query = dataQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      const board = await loadBoard(tx, actor.tenantId, params.data.boardId);
      if (!board) return reply.code(404).send({ error: 'board_not_found' });
      if (!(await canAccessWorkspace(tx, actor, board.workspace_id))) return reply.code(403).send({ error: 'workspace_access_denied' });
      const config = await loadBoardConfig(tx, actor.tenantId, board.id);
      const selectedView = query.data.viewId
        ? config.views.find((view) => view.id === query.data.viewId)
        : config.views.find((view) => view.is_default) ?? config.views[0] ?? null;
      if (query.data.viewId && !selectedView) return reply.code(404).send({ error: 'view_not_found' });

      const placements = await tx.$queryRaw<PlacementRow[]>(Prisma.sql`
        SELECT object_id, group_id, sort_order FROM work_board_item_placements_v1
        WHERE tenant_id = ${actor.tenantId}::uuid AND board_id = ${board.id}::uuid
        ORDER BY sort_order, object_id
      `);
      const objectIds = placements.map((item) => item.object_id);
      const objects = objectIds.length === 0 ? [] : await tx.nexusObject.findMany({
        where: { tenantId: actor.tenantId, id: { in: objectIds }, deletedAt: null },
        include: {
          owner: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
          assignee: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
          fieldValues: true,
        },
      });
      const objectMap = new Map(objects.map((object) => [object.id, object]));
      const items = placements.flatMap((placement) => {
        const object = objectMap.get(placement.object_id);
        if (!object) return [];
        const customFields = Object.fromEntries(object.fieldValues.map((field) => [field.fieldKey,
          field.valueText ?? field.valueNumber?.toString() ?? field.valueDate?.toISOString() ?? field.valueBoolean ?? field.valueJson ?? null]));
        return [{
          object: {
            id: object.id, objectTypeKey: object.objectTypeKey, title: object.title, description: object.description,
            status: object.status, priority: object.priority, progress: object.progress, ownerId: object.ownerId,
            assigneeId: object.assigneeId, startDate: object.startDate, dueDate: object.dueDate,
            createdAt: object.createdAt, updatedAt: object.updatedAt, version: object.version,
            owner: object.owner, assignee: object.assignee,
          },
          customFields,
          placement: { groupId: placement.group_id, sortOrder: placement.sort_order },
        }];
      });
      return { board: serializeBoard(board), ...config, selectedView, items };
    });
  });

  app.post('/api/v1/work-os/boards-v1/:boardId/groups', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = boardParamsSchema.safeParse(request.params);
    const body = createGroupSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      const board = await loadBoard(tx, actor.tenantId, params.data.boardId);
      if (!board) return reply.code(404).send({ error: 'board_not_found' });
      if (!(await canManageWorkspace(tx, actor, board.workspace_id))) return reply.code(403).send({ error: 'workspace_manage_denied' });
      const key = normalizeBoardKeyV1(body.data.key ?? body.data.name);
      const rows = await tx.$queryRaw<GroupRow[]>(Prisma.sql`
        INSERT INTO work_board_groups_v1 (tenant_id, board_id, key, name, color, sort_order)
        VALUES (${actor.tenantId}::uuid, ${board.id}::uuid, ${key}, ${body.data.name}, ${body.data.color ?? null}, ${body.data.sortOrder ?? 100})
        RETURNING id, key, name, color, sort_order
      `);
      return reply.code(201).send(rows[0]);
    });
  });

  app.post('/api/v1/work-os/boards-v1/:boardId/columns', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = boardParamsSchema.safeParse(request.params);
    const body = createColumnSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    try { validateBoardColumnV1(body.data); } catch (error) {
      if (error instanceof WorkBoardValidationError) return reply.code(400).send({ error: 'invalid_board_column', message: error.message });
      throw error;
    }
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      const board = await loadBoard(tx, actor.tenantId, params.data.boardId);
      if (!board) return reply.code(404).send({ error: 'board_not_found' });
      if (!(await canManageWorkspace(tx, actor, board.workspace_id))) return reply.code(403).send({ error: 'workspace_manage_denied' });
      const key = normalizeBoardKeyV1(body.data.key ?? body.data.label);
      const rows = await tx.$queryRaw<ColumnRow[]>(Prisma.sql`
        INSERT INTO work_board_columns_v1
          (tenant_id, board_id, key, label, source, data_type, field_key, width, sort_order, is_visible, is_editable, config)
        VALUES
          (${actor.tenantId}::uuid, ${board.id}::uuid, ${key}, ${body.data.label},
           ${body.data.source}::"WorkBoardColumnSourceV1", ${body.data.dataType}::"WorkBoardColumnTypeV1", ${body.data.fieldKey},
           ${body.data.width ?? null}, ${body.data.sortOrder ?? 100}, ${body.data.isVisible ?? true}, ${body.data.isEditable ?? true},
           ${JSON.stringify(body.data.config ?? {})}::jsonb)
        RETURNING id, key, label, source, data_type, field_key, width, sort_order, is_visible, is_editable, config
      `);
      return reply.code(201).send(rows[0]);
    });
  });

  app.post('/api/v1/work-os/boards-v1/:boardId/views', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = boardParamsSchema.safeParse(request.params);
    const body = createViewSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    try { validateViewConfigV1(body.data.viewType, body.data.config); } catch (error) {
      if (error instanceof WorkBoardValidationError) return reply.code(400).send({ error: 'invalid_work_view', message: error.message });
      throw error;
    }
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      const board = await loadBoard(tx, actor.tenantId, params.data.boardId);
      if (!board) return reply.code(404).send({ error: 'board_not_found' });
      if (!(await canManageWorkspace(tx, actor, board.workspace_id))) return reply.code(403).send({ error: 'workspace_manage_denied' });
      if (body.data.isDefault) {
        await tx.$executeRaw(Prisma.sql`UPDATE work_views_v1 SET is_default = false WHERE tenant_id = ${actor.tenantId}::uuid AND board_id = ${board.id}::uuid`);
      }
      const rows = await tx.$queryRaw<ViewRow[]>(Prisma.sql`
        INSERT INTO work_views_v1 (tenant_id, board_id, name, view_type, is_default, sort_order, config)
        VALUES (${actor.tenantId}::uuid, ${board.id}::uuid, ${body.data.name}, ${body.data.viewType}::"WorkViewTypeV1",
          ${body.data.isDefault ?? false}, ${body.data.sortOrder ?? 100}, ${JSON.stringify(body.data.config)}::jsonb)
        RETURNING id, name, view_type, is_default, sort_order, config
      `);
      return reply.code(201).send(rows[0]);
    });
  });

  app.post('/api/v1/work-os/boards-v1/:boardId/items', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = boardParamsSchema.safeParse(request.params);
    const body = placeItemSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      const board = await loadBoard(tx, actor.tenantId, params.data.boardId);
      if (!board) return reply.code(404).send({ error: 'board_not_found' });
      if (!(await canManageWorkspace(tx, actor, board.workspace_id))) return reply.code(403).send({ error: 'workspace_manage_denied' });
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO work_board_item_placements_v1 (tenant_id, board_id, object_id, group_id, sort_order)
        VALUES (${actor.tenantId}::uuid, ${board.id}::uuid, ${body.data.objectId}::uuid, ${body.data.groupId ?? null}::uuid, ${body.data.sortOrder ?? 100})
        ON CONFLICT (board_id, object_id)
        DO UPDATE SET group_id = EXCLUDED.group_id, sort_order = EXCLUDED.sort_order, updated_at = CURRENT_TIMESTAMP
      `);
      return reply.code(204).send();
    });
  });

  app.patch('/api/v1/work-os/boards-v1/:boardId/items/:objectId', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = boardObjectParamsSchema.safeParse(request.params);
    const body = updatePlacementSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      const board = await loadBoard(tx, actor.tenantId, params.data.boardId);
      if (!board) return reply.code(404).send({ error: 'board_not_found' });
      if (!(await canManageWorkspace(tx, actor, board.workspace_id))) return reply.code(403).send({ error: 'workspace_manage_denied' });
      const changed = await tx.$executeRaw(Prisma.sql`
        UPDATE work_board_item_placements_v1
        SET group_id = COALESCE(${body.data.groupId ?? null}::uuid, group_id),
            sort_order = COALESCE(${body.data.sortOrder ?? null}::integer, sort_order),
            updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${actor.tenantId}::uuid AND board_id = ${board.id}::uuid AND object_id = ${params.data.objectId}::uuid
      `);
      if (changed !== 1) return reply.code(404).send({ error: 'board_item_not_found' });
      return reply.code(204).send();
    });
  });
}
