import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canAccessWorkspace, canManageWorkspace } from '../authorization.js';
import {
  BoardTemporalValidationError,
  normalizeTemporalRangeV1,
  validateBoardTemporalConfigV1,
  type BoardTemporalConfigV1,
} from '../domain/board-temporal-v1.js';
import { withTenant } from '../tenant-transaction.js';

const uuid = z.string().uuid();
const viewParams = z.object({ boardId: uuid, viewId: uuid });
const boardParams = z.object({ boardId: uuid });
const temporalConfigSchema = z.object({
  startFieldKey: z.string().trim().min(1).max(100),
  endFieldKey: z.string().trim().min(1).max(100).nullable().optional(),
  titleFieldKey: z.string().trim().min(1).max(100).optional(),
  colorFieldKey: z.string().trim().min(1).max(100).nullable().optional(),
  allDay: z.boolean().optional(),
});
const createTemporalViewSchema = z.object({
  name: z.string().trim().min(1).max(255),
  viewType: z.enum(['CALENDAR', 'TIMELINE']),
  config: temporalConfigSchema,
});
const temporalQuerySchema = z.object({
  viewId: uuid,
  from: z.coerce.date(),
  to: z.coerce.date(),
}).refine((value) => value.to >= value.from, { message: 'to must be >= from' });

type BoardRow = { id: string; workspace_id: string; object_definition_id: string };
type ViewRow = { id: string; name: string; view_type: 'CALENDAR' | 'TIMELINE'; config: Record<string, unknown> };
type ColumnRow = { field_key: string; data_type: string };
type PlacementRow = { object_id: string; group_id: string | null; sort_order: number };

async function getBoard(tx: Prisma.TransactionClient, tenantId: string, boardId: string): Promise<BoardRow | null> {
  const rows = await tx.$queryRaw<BoardRow[]>(Prisma.sql`
    SELECT id, workspace_id, object_definition_id
    FROM work_boards_v1
    WHERE tenant_id = ${tenantId}::uuid AND id = ${boardId}::uuid AND is_archived = false
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function getTemporalView(tx: Prisma.TransactionClient, tenantId: string, boardId: string, viewId: string): Promise<ViewRow | null> {
  const rows = await tx.$queryRaw<ViewRow[]>(Prisma.sql`
    SELECT id, name, view_type, config
    FROM work_views_v1
    WHERE tenant_id = ${tenantId}::uuid AND board_id = ${boardId}::uuid AND id = ${viewId}::uuid
      AND view_type IN ('CALENDAR'::"WorkViewTypeV1", 'TIMELINE'::"WorkViewTypeV1")
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function boardColumns(tx: Prisma.TransactionClient, tenantId: string, boardId: string): Promise<ColumnRow[]> {
  return tx.$queryRaw<ColumnRow[]>(Prisma.sql`
    SELECT field_key, data_type
    FROM work_board_columns_v1
    WHERE tenant_id = ${tenantId}::uuid AND board_id = ${boardId}::uuid
  `);
}

function temporalConfigFromView(view: ViewRow): BoardTemporalConfigV1 | null {
  const temporal = view.config && typeof view.config === 'object' ? (view.config.temporal as unknown) : null;
  const parsed = temporalConfigSchema.safeParse(temporal);
  return parsed.success ? parsed.data : null;
}

function objectTemporalValue(
  object: { startDate: Date | null; dueDate: Date | null; fieldValues: Array<{ fieldKey: string; valueDate: Date | null }> },
  fieldKey: string | null | undefined,
): Date | null {
  if (!fieldKey) return null;
  if (fieldKey === 'startDate') return object.startDate;
  if (fieldKey === 'dueDate') return object.dueDate;
  return object.fieldValues.find((field) => field.fieldKey === fieldKey)?.valueDate ?? null;
}

export async function workOsBoardTemporalV1Routes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/work-os/boards-v1/:boardId/temporal-views', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = boardParams.safeParse(request.params);
    const body = createTemporalViewSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error', details: body.success ? undefined : body.error.flatten() });
    const actor = request.actor!;

    return withTenant(actor.tenantId, async (tx) => {
      const board = await getBoard(tx, actor.tenantId, params.data.boardId);
      if (!board) return reply.code(404).send({ error: 'board_not_found' });
      if (!(await canManageWorkspace(tx, actor, board.workspace_id))) return reply.code(403).send({ error: 'workspace_manage_denied' });
      const columns = await boardColumns(tx, actor.tenantId, board.id);
      let temporal: BoardTemporalConfigV1;
      try {
        temporal = validateBoardTemporalConfigV1(body.data.config, columns.map((column) => ({ fieldKey: column.field_key, dataType: column.data_type })));
      } catch (error) {
        if (error instanceof BoardTemporalValidationError) return reply.code(400).send({ error: 'invalid_temporal_config', message: error.message });
        throw error;
      }
      const rows = await tx.$queryRaw<ViewRow[]>(Prisma.sql`
        INSERT INTO work_views_v1 (tenant_id, board_id, name, view_type, is_default, sort_order, config)
        VALUES (${actor.tenantId}::uuid, ${board.id}::uuid, ${body.data.name}, ${body.data.viewType}::"WorkViewTypeV1", false, 500, ${JSON.stringify({ temporal })}::jsonb)
        RETURNING id, name, view_type, config
      `);
      await tx.auditLog.create({ data: {
        tenantId: actor.tenantId, userId: actor.userId, action: 'BOARD_TEMPORAL_VIEW_CREATED', resource: 'WORK_VIEW_V1',
        resourceId: rows[0]!.id, correlationId: request.id, ipAddress: request.ip,
        details: { boardId: board.id, viewType: body.data.viewType, temporal },
      } });
      return reply.code(201).send(rows[0]);
    });
  });

  app.put('/api/v1/work-os/boards-v1/:boardId/views/:viewId/temporal-config', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = viewParams.safeParse(request.params);
    const body = temporalConfigSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error', details: body.success ? undefined : body.error.flatten() });
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      const board = await getBoard(tx, actor.tenantId, params.data.boardId);
      if (!board) return reply.code(404).send({ error: 'board_not_found' });
      if (!(await canManageWorkspace(tx, actor, board.workspace_id))) return reply.code(403).send({ error: 'workspace_manage_denied' });
      const view = await getTemporalView(tx, actor.tenantId, board.id, params.data.viewId);
      if (!view) return reply.code(404).send({ error: 'temporal_view_not_found' });
      const columns = await boardColumns(tx, actor.tenantId, board.id);
      let temporal: BoardTemporalConfigV1;
      try {
        temporal = validateBoardTemporalConfigV1(body.data, columns.map((column) => ({ fieldKey: column.field_key, dataType: column.data_type })));
      } catch (error) {
        if (error instanceof BoardTemporalValidationError) return reply.code(400).send({ error: 'invalid_temporal_config', message: error.message });
        throw error;
      }
      const nextConfig = { ...(view.config ?? {}), temporal };
      await tx.$executeRaw(Prisma.sql`
        UPDATE work_views_v1 SET config = ${JSON.stringify(nextConfig)}::jsonb, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${actor.tenantId}::uuid AND board_id = ${board.id}::uuid AND id = ${view.id}::uuid
      `);
      return { id: view.id, temporal };
    });
  });

  app.get('/api/v1/work-os/boards-v1/:boardId/temporal-data', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = boardParams.safeParse(request.params);
    const query = temporalQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: 'validation_error', details: query.success ? undefined : query.error.flatten() });
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      const board = await getBoard(tx, actor.tenantId, params.data.boardId);
      if (!board) return reply.code(404).send({ error: 'board_not_found' });
      if (!(await canAccessWorkspace(tx, actor, board.workspace_id))) return reply.code(403).send({ error: 'workspace_access_denied' });
      const view = await getTemporalView(tx, actor.tenantId, board.id, query.data.viewId);
      if (!view) return reply.code(404).send({ error: 'temporal_view_not_found' });
      const rawConfig = temporalConfigFromView(view);
      if (!rawConfig) return reply.code(409).send({ error: 'temporal_view_not_configured' });
      const columns = await boardColumns(tx, actor.tenantId, board.id);
      let temporal: BoardTemporalConfigV1;
      try {
        temporal = validateBoardTemporalConfigV1(rawConfig, columns.map((column) => ({ fieldKey: column.field_key, dataType: column.data_type })));
      } catch (error) {
        if (error instanceof BoardTemporalValidationError) return reply.code(409).send({ error: 'invalid_saved_temporal_config', message: error.message });
        throw error;
      }

      const placements = await tx.$queryRaw<PlacementRow[]>(Prisma.sql`
        SELECT object_id, group_id, sort_order FROM work_board_item_placements_v1
        WHERE tenant_id = ${actor.tenantId}::uuid AND board_id = ${board.id}::uuid
        ORDER BY sort_order, object_id
      `);
      const objectIds = placements.map((row) => row.object_id);
      if (!objectIds.length) return { viewId: view.id, viewType: view.view_type, temporal, items: [] };
      const placementByObject = new Map(placements.map((row) => [row.object_id, row]));
      const objects = await tx.nexusObject.findMany({
        where: {
          tenantId: actor.tenantId, workspaceId: board.workspace_id, objectDefinitionId: board.object_definition_id,
          id: { in: objectIds }, deletedAt: null,
        },
        select: {
          id: true, objectTypeKey: true, title: true, status: true, priority: true, progress: true,
          startDate: true, dueDate: true,
          assignee: { select: { id: true, fullName: true, avatarUrl: true } },
          fieldValues: { where: { fieldKey: { in: [temporal.startFieldKey, temporal.endFieldKey ?? ''] } }, select: { fieldKey: true, valueDate: true } },
        },
      });

      const items = objects.flatMap((object) => {
        const start = objectTemporalValue(object, temporal.startFieldKey);
        if (!start) return [];
        const end = objectTemporalValue(object, temporal.endFieldKey) ?? start;
        const range = normalizeTemporalRangeV1(start, end);
        if (range.end < query.data.from || range.start > query.data.to) return [];
        const placement = placementByObject.get(object.id);
        return [{
          objectId: object.id,
          objectTypeKey: object.objectTypeKey,
          title: object.title,
          status: object.status,
          priority: object.priority,
          progress: object.progress,
          start: range.start.toISOString(),
          end: range.end.toISOString(),
          groupId: placement?.group_id ?? null,
          sortOrder: placement?.sort_order ?? 0,
          assignee: object.assignee ? { id: object.assignee.id, fullName: object.assignee.fullName, avatarUrl: object.assignee.avatarUrl } : null,
        }];
      }).sort((a, b) => a.start.localeCompare(b.start) || a.sortOrder - b.sortOrder);

      return { viewId: view.id, viewType: view.view_type, temporal, items };
    });
  });
}
