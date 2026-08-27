import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canAccessWorkspace, canManageWorkspace } from '../authorization.js';
import { config } from '../config.js';
import { withTenant } from '../tenant-transaction.js';

const uuid = z.string().uuid();
const resourceType = z.enum(['ROOM', 'EQUIPMENT']);
const resourceParams = z.object({ resourceId: uuid });
const meetingParams = z.object({ meetingObjectId: uuid });
const resourceQuery = z.object({
  workspaceId: uuid,
  includeInactive: z.coerce.boolean().default(false),
});
const resourceInput = z.object({
  workspaceId: uuid,
  resourceType,
  name: z.string().trim().min(1).max(255),
  email: z.string().trim().email().max(320),
  location: z.string().trim().max(500).nullable().optional(),
  capacity: z.number().int().min(1).max(10000).nullable().optional(),
  features: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  isActive: z.boolean().default(true),
});
const resourceUpdateInput = resourceInput.omit({ workspaceId: true }).partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one field must be supplied.' },
);
const bookingInput = z.object({
  resourceIds: z.array(uuid).max(20).default([]),
  requestM365Sync: z.boolean().default(true),
});

type ResourceRow = {
  id: string;
  workspace_id: string;
  resource_type: 'ROOM' | 'EQUIPMENT';
  name: string;
  email: string;
  location: string | null;
  capacity: number | null;
  features: unknown;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

type CollaborationRow = {
  id: string;
  workspace_id: string;
  organizer_user_id: string;
  graph_event_id: string | null;
};

function mapResource(row: ResourceRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    resourceType: row.resource_type,
    name: row.name,
    email: row.email,
    location: row.location,
    capacity: row.capacity,
    features: Array.isArray(row.features) ? row.features.filter((value): value is string => typeof value === 'string') : [],
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function syncAvailable(): boolean {
  return config.M365_CALENDAR_SYNC_ENABLED && config.MEETING_CALENDAR_WORKER_AVAILABLE;
}

async function meetingCollaboration(
  tx: Prisma.TransactionClient,
  tenantId: string,
  meetingObjectId: string,
): Promise<CollaborationRow | null> {
  const rows = await tx.$queryRaw<CollaborationRow[]>(Prisma.sql`
    SELECT id, workspace_id, organizer_user_id, graph_event_id
    FROM meeting_collaboration_v1
    WHERE tenant_id = ${tenantId}::uuid AND meeting_object_id = ${meetingObjectId}::uuid
    LIMIT 1
  `);
  return rows[0] ?? null;
}

export async function meetingResourcesV1Routes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/meetings-v1/resources', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const query = resourceQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'validation_error', details: query.error.flatten() });
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      if (!(await canAccessWorkspace(tx, actor, query.data.workspaceId))) {
        return reply.code(403).send({ error: 'workspace_access_denied' });
      }
      const rows = await tx.$queryRaw<ResourceRow[]>(Prisma.sql`
        SELECT id, workspace_id, resource_type, name, email, location, capacity, features, is_active, created_at, updated_at
        FROM meeting_resources_v1
        WHERE tenant_id = ${actor.tenantId}::uuid
          AND workspace_id = ${query.data.workspaceId}::uuid
          AND (${query.data.includeInactive} OR is_active = true)
        ORDER BY resource_type, name, id
      `);
      return { items: rows.map(mapResource) };
    });
  });

  app.post('/api/v1/meetings-v1/resources', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const body = resourceInput.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'validation_error', details: body.error.flatten() });
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      if (!(await canManageWorkspace(tx, actor, body.data.workspaceId))) {
        return reply.code(403).send({ error: 'workspace_management_denied' });
      }
      try {
        const rows = await tx.$queryRaw<ResourceRow[]>(Prisma.sql`
          INSERT INTO meeting_resources_v1
            (tenant_id, workspace_id, resource_type, name, email, location, capacity, features, is_active, created_by)
          VALUES
            (${actor.tenantId}::uuid, ${body.data.workspaceId}::uuid, ${body.data.resourceType}, ${body.data.name},
             ${body.data.email.toLowerCase()}, ${body.data.location ?? null}, ${body.data.capacity ?? null},
             ${JSON.stringify(body.data.features)}::jsonb, ${body.data.isActive}, ${actor.userId}::uuid)
          RETURNING id, workspace_id, resource_type, name, email, location, capacity, features, is_active, created_at, updated_at
        `);
        const resource = mapResource(rows[0]!);
        await tx.auditLog.create({
          data: {
            tenantId: actor.tenantId,
            userId: actor.userId,
            action: 'MEETING_RESOURCE_CREATED',
            resource: 'MEETING_RESOURCE_V1',
            resourceId: resource.id,
            correlationId: request.id,
            ipAddress: request.ip,
            details: { workspaceId: body.data.workspaceId, resourceType: body.data.resourceType, email: resource.email },
          },
        });
        return reply.code(201).send(resource);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2010') {
          return reply.code(409).send({ error: 'meeting_resource_conflict', message: 'A meeting resource with that mailbox may already exist.' });
        }
        throw error;
      }
    });
  });

  app.put('/api/v1/meetings-v1/resources/:resourceId', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = resourceParams.safeParse(request.params);
    const body = resourceUpdateInput.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      const current = await tx.$queryRaw<ResourceRow[]>(Prisma.sql`
        SELECT id, workspace_id, resource_type, name, email, location, capacity, features, is_active, created_at, updated_at
        FROM meeting_resources_v1
        WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${params.data.resourceId}::uuid
        LIMIT 1
      `);
      const row = current[0];
      if (!row) return reply.code(404).send({ error: 'meeting_resource_not_found' });
      if (!(await canManageWorkspace(tx, actor, row.workspace_id))) {
        return reply.code(403).send({ error: 'workspace_management_denied' });
      }
      const next = {
        resourceType: body.data.resourceType ?? row.resource_type,
        name: body.data.name ?? row.name,
        email: (body.data.email ?? row.email).toLowerCase(),
        location: body.data.location === undefined ? row.location : body.data.location,
        capacity: body.data.capacity === undefined ? row.capacity : body.data.capacity,
        features: body.data.features ?? (Array.isArray(row.features) ? row.features : []),
        isActive: body.data.isActive ?? row.is_active,
      };
      const rows = await tx.$queryRaw<ResourceRow[]>(Prisma.sql`
        UPDATE meeting_resources_v1
        SET resource_type = ${next.resourceType}, name = ${next.name}, email = ${next.email},
            location = ${next.location}, capacity = ${next.capacity}, features = ${JSON.stringify(next.features)}::jsonb,
            is_active = ${next.isActive}, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${row.id}::uuid
        RETURNING id, workspace_id, resource_type, name, email, location, capacity, features, is_active, created_at, updated_at
      `);
      const resource = mapResource(rows[0]!);
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          userId: actor.userId,
          action: 'MEETING_RESOURCE_UPDATED',
          resource: 'MEETING_RESOURCE_V1',
          resourceId: resource.id,
          correlationId: request.id,
          ipAddress: request.ip,
          details: { isActive: resource.isActive, resourceType: resource.resourceType },
        },
      });
      return resource;
    });
  });

  app.get('/api/v1/meetings-v1/:meetingObjectId/resources', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = meetingParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      const collaboration = await meetingCollaboration(tx, actor.tenantId, params.data.meetingObjectId);
      if (!collaboration) return reply.code(404).send({ error: 'meeting_not_found' });
      if (!(await canAccessWorkspace(tx, actor, collaboration.workspace_id))) {
        return reply.code(403).send({ error: 'workspace_access_denied' });
      }
      const rows = await tx.$queryRaw<ResourceRow[]>(Prisma.sql`
        SELECT r.id, r.workspace_id, r.resource_type, r.name, r.email, r.location, r.capacity, r.features, r.is_active, r.created_at, r.updated_at
        FROM meeting_resource_bookings_v1 b
        JOIN meeting_resources_v1 r ON r.id = b.meeting_resource_id
        WHERE b.tenant_id = ${actor.tenantId}::uuid
          AND b.meeting_collaboration_id = ${collaboration.id}::uuid
        ORDER BY r.resource_type, r.name
      `);
      return { items: rows.map(mapResource) };
    });
  });

  app.put('/api/v1/meetings-v1/:meetingObjectId/resources', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = meetingParams.safeParse(request.params);
    const body = bookingInput.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      const collaboration = await meetingCollaboration(tx, actor.tenantId, params.data.meetingObjectId);
      if (!collaboration) return reply.code(404).send({ error: 'meeting_not_found' });
      const canManage = await canManageWorkspace(tx, actor, collaboration.workspace_id);
      if (!canManage && collaboration.organizer_user_id !== actor.userId) {
        return reply.code(403).send({ error: 'meeting_resource_booking_denied' });
      }

      const ids = [...new Set(body.data.resourceIds)];
      const resources = ids.length
        ? await tx.$queryRaw<ResourceRow[]>(Prisma.sql`
            SELECT id, workspace_id, resource_type, name, email, location, capacity, features, is_active, created_at, updated_at
            FROM meeting_resources_v1
            WHERE tenant_id = ${actor.tenantId}::uuid
              AND workspace_id = ${collaboration.workspace_id}::uuid
              AND id = ANY(${ids}::uuid[])
              AND is_active = true
          `)
        : [];
      if (resources.length !== ids.length) {
        return reply.code(409).send({ error: 'meeting_resource_invalid_or_inactive' });
      }

      await tx.$executeRaw(Prisma.sql`
        DELETE FROM meeting_resource_bookings_v1
        WHERE tenant_id = ${actor.tenantId}::uuid
          AND meeting_collaboration_id = ${collaboration.id}::uuid
      `);
      for (const resource of resources) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO meeting_resource_bookings_v1
            (tenant_id, meeting_collaboration_id, meeting_resource_id, created_by)
          VALUES
            (${actor.tenantId}::uuid, ${collaboration.id}::uuid, ${resource.id}::uuid, ${actor.userId}::uuid)
        `);
      }

      const canSync = syncAvailable();
      const shouldSync = Boolean(collaboration.graph_event_id) || (body.data.requestM365Sync && canSync);
      if (shouldSync) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE meeting_collaboration_v1
          SET sync_status = 'PENDING'::"MeetingM365SyncStatusV1", sync_error = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${collaboration.id}::uuid
        `);
        await tx.domainEvent.create({
          data: {
            tenantId: actor.tenantId,
            aggregateId: params.data.meetingObjectId,
            eventType: 'bridata.meeting.m365.sync.requested',
            payload: { collaborationId: collaboration.id, meetingObjectId: params.data.meetingObjectId, reason: 'resources_changed' },
          },
        });
      }

      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          userId: actor.userId,
          action: 'MEETING_RESOURCES_REPLACED',
          resource: 'MEETING_COLLABORATION_V1',
          resourceId: collaboration.id,
          correlationId: request.id,
          ipAddress: request.ip,
          details: {
            resourceIds: resources.map((resource) => resource.id),
            resourceCount: resources.length,
            syncRequested: shouldSync,
            syncDeferred: body.data.requestM365Sync && !canSync && !collaboration.graph_event_id,
          },
        },
      });

      return {
        items: resources.map(mapResource),
        syncRequested: shouldSync,
        syncDeferred: body.data.requestM365Sync && !canSync && !collaboration.graph_event_id,
      };
    });
  });
}
