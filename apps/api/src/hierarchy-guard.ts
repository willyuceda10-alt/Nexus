import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { ActorContext } from './auth.js';
import { withTenant } from './tenant-transaction.js';

const createBodySchema = z.object({
  workspaceId: z.string().uuid(),
  objectTypeKey: z.string().trim().min(1),
  metadata: z.record(z.unknown()).optional(),
}).passthrough();

const patchBodySchema = z.object({
  metadata: z.record(z.unknown()).nullable().optional(),
}).passthrough();

const idParamsSchema = z.object({ id: z.string().uuid() });
const hierarchyObjectTypes = new Set(['PORTFOLIO', 'PROGRAM']);

function jsonRecord(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, Prisma.JsonValue>;
}

function metadataId(metadata: Record<string, unknown>, key: 'portfolioId' | 'programId'): string | null | 'invalid' {
  const value = metadata[key];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !z.string().uuid().safeParse(value).success) return 'invalid';
  return value;
}

function isTenantAdmin(actor: ActorContext): boolean {
  return actor.role === 'OWNER' || actor.role === 'TENANT_ADMIN';
}

async function canManageWorkspace(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  workspaceId: string,
): Promise<boolean> {
  if (isTenantAdmin(actor)) return true;

  const membership = await tx.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: actor.userId } },
    select: { tenantId: true, role: true },
  });

  return Boolean(
    membership?.tenantId === actor.tenantId &&
    ['OWNER', 'ADMIN', 'MANAGER'].includes(membership.role),
  );
}

type ValidationResult =
  | { kind: 'ok' }
  | { kind: 'invalid'; message: string }
  | { kind: 'not_found'; message: string }
  | { kind: 'mismatch'; message: string };

async function validateHierarchyMetadata(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  workspaceId: string,
  objectTypeKey: string,
  metadata: Record<string, unknown>,
): Promise<ValidationResult> {
  const portfolioId = metadataId(metadata, 'portfolioId');
  const programId = metadataId(metadata, 'programId');

  if (portfolioId === 'invalid' || programId === 'invalid') {
    return {
      kind: 'invalid',
      message: 'portfolioId and programId must be UUIDs when provided.',
    };
  }

  if (objectTypeKey === 'PORTFOLIO') {
    if (portfolioId || programId) {
      return {
        kind: 'invalid',
        message: 'A portfolio cannot reference a parent portfolio or program.',
      };
    }
    return { kind: 'ok' };
  }

  if (objectTypeKey === 'PROGRAM' && !portfolioId) {
    return {
      kind: 'invalid',
      message: 'A program must reference a portfolioId.',
    };
  }

  let portfolio: { id: string } | null = null;
  if (portfolioId) {
    portfolio = await tx.nexusObject.findFirst({
      where: {
        id: portfolioId,
        tenantId: actor.tenantId,
        workspaceId,
        objectTypeKey: 'PORTFOLIO',
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!portfolio) {
      return {
        kind: 'not_found',
        message: 'The referenced portfolio does not exist in this workspace.',
      };
    }
  }

  let program: { id: string; metadata: Prisma.JsonValue | null } | null = null;
  if (programId) {
    program = await tx.nexusObject.findFirst({
      where: {
        id: programId,
        tenantId: actor.tenantId,
        workspaceId,
        objectTypeKey: 'PROGRAM',
        deletedAt: null,
      },
      select: { id: true, metadata: true },
    });
    if (!program) {
      return {
        kind: 'not_found',
        message: 'The referenced program does not exist in this workspace.',
      };
    }
  }

  if (objectTypeKey === 'PROGRAM' && programId) {
    return {
      kind: 'invalid',
      message: 'A program cannot reference another program as its parent.',
    };
  }

  if (program) {
    const parentPortfolioId = jsonRecord(program.metadata).portfolioId;
    if (typeof parentPortfolioId !== 'string') {
      return {
        kind: 'mismatch',
        message: 'The referenced program has no valid parent portfolio.',
      };
    }
    if (portfolioId && parentPortfolioId !== portfolioId) {
      return {
        kind: 'mismatch',
        message: 'programId belongs to a different portfolio than portfolioId.',
      };
  }

  return { kind: 'ok' };
}

async function sendValidationError(reply: FastifyReply, result: Exclude<ValidationResult, { kind: 'ok' }>) {
  if (result.kind === 'invalid') {
    await reply.code(400).send({ error: 'invalid_hierarchy_metadata', message: result.message });
    return;
  }
  if (result.kind === 'not_found') {
    await reply.code(404).send({ error: 'hierarchy_reference_not_found', message: result.message });
    return;
  }
  await reply.code(409).send({ error: 'hierarchy_mismatch', message: result.message });
}

async function hierarchyWriteGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const actor = request.actor;
  if (!actor) return;

  if (request.method === 'POST') {
    const parsed = createBodySchema.safeParse(request.body);
    if (!parsed.success) return;

    const { workspaceId, objectTypeKey, metadata = {} } = parsed.data;
    const result = await withTenant(actor.tenantId, async (tx) => {
      if (hierarchyObjectTypes.has(objectTypeKey) && !(await canManageWorkspace(tx, actor, workspaceId))) {
        return { kind: 'forbidden' as const };
      }

      if (!['PORTFOLIO', 'PROGRAM', 'PROJECT'].includes(objectTypeKey)) {
        return { kind: 'ok' as const };
      }

      const validation = await validateHierarchyMetadata(tx, actor, workspaceId, objectTypeKey, metadata);
      return validation;
    });

    if (result.kind === 'forbidden') {
      await reply.code(403).send({
        error: 'hierarchy_management_denied',
        message: 'Managing portfolios and programs requires a management role in this workspace.',
      });
      return;
    }
    if (result.kind !== 'ok') await sendValidationError(reply, result);
    return;
  }

  if (request.method === 'PATCH') {
    const params = idParamsSchema.safeParse(request.params);
    const body = patchBodySchema.safeParse(request.body);
    if (!params.success || !body.success) return;

    const result = await withTenant(actor.tenantId, async (tx) => {
      const current = await tx.nexusObject.findFirst({
        where: { id: params.data.id, tenantId: actor.tenantId, deletedAt: null },
        select: { workspaceId: true, objectTypeKey: true, metadata: true },
      });
      if (!current) return { kind: 'ok' as const };

      if (
        hierarchyObjectTypes.has(current.objectTypeKey) &&
        !(await canManageWorkspace(tx, actor, current.workspaceId))
      ) {
        return { kind: 'forbidden' as const };
      }

      if (!['PORTFOLIO', 'PROGRAM', 'PROJECT'].includes(current.objectTypeKey)) {
        return { kind: 'ok' as const };
      }
      if (body.data.metadata === undefined) return { kind: 'ok' as const };

      const metadata = body.data.metadata ?? {};
      return validateHierarchyMetadata(
        tx,
        actor,
        current.workspaceId,
        current.objectTypeKey,
        metadata,
      );
    });

    if (result.kind === 'forbidden') {
      await reply.code(403).send({
        error: 'hierarchy_management_denied',
        message: 'Managing portfolios and programs requires a management role in this workspace.',
      });
      return;
    }
    if (result.kind !== 'ok') await sendValidationError(reply, result);
  }
}

export function registerHierarchyWriteGuards(app: FastifyInstance): void {
  app.addHook('onRoute', (routeOptions) => {
    const methods = Array.isArray(routeOptions.method) ? routeOptions.method : [routeOptions.method];
    const isCreate = routeOptions.url === '/api/v1/objects' && methods.includes('POST');
    const isPatch = routeOptions.url === '/api/v1/objects/:id' && methods.includes('PATCH');
    if (!isCreate && !isPatch) return;

    const existing = routeOptions.preHandler;
    routeOptions.preHandler = existing
      ? Array.isArray(existing)
        ? [...existing, hierarchyWriteGuard]
        : [existing, hierarchyWriteGuard]
      : [hierarchyWriteGuard];
  });
}
