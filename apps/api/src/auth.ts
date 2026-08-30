import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import { config } from './config.js';
import { validateEntraTenantClaims } from './entra-multitenant-auth-h44.js';
import { prisma } from './db.js';
import { withTenant } from './tenant-transaction.js';
import {
  SAP_INTERNAL_ORCHESTRATION_HEADER_V1F2,
  SAP_INTERNAL_OWNER_HEADER_V1F2,
  isAllowedSapInternalOrchestrationPathV1f2,
  matchesSapInternalOrchestrationSecretV1f2,
} from './internal-sap-orchestration-auth-v1f2.js';

export type AuthProvider = 'ENTRA_ID' | 'DEV' | 'INTERNAL_AUTOMATION';

export interface AuthPrincipal {
  provider: AuthProvider;
  issuer: string;
  subject: string;
  providerTenantId?: string;
  email?: string;
  name?: string;
  devUserId?: string;
  devTenantId?: string;
  internalUserId?: string;
  internalTenantId?: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  isActive: boolean;
}

export interface ActorContext {
  tenantId: string;
  userId: string;
  membershipId: string;
  role: string;
  email: string;
  name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    authPrincipal: AuthPrincipal | null;
    actor: ActorContext | null;
  }
}

const MAX_ENTRA_JWKS_TENANTS = 128;

const entraJwksByTenant =
  new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getEntraJwksForTenant(
  tenantId: string,
): ReturnType<typeof createRemoteJWKSet> {
  const cached = entraJwksByTenant.get(tenantId);

  if (cached) {
    return cached;
  }

  if (entraJwksByTenant.size >= MAX_ENTRA_JWKS_TENANTS) {
    const oldestTenantId = entraJwksByTenant.keys().next().value;

    if (oldestTenantId) {
      entraJwksByTenant.delete(oldestTenantId);
    }
  }

  const jwks = createRemoteJWKSet(
    new URL(
      `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
    ),
  );

  entraJwksByTenant.set(tenantId, jwks);

  return jwks;
}

function isUuidV1f2(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function registerRequestContext(app: FastifyInstance): void {
  app.decorateRequest('authPrincipal', null);
  app.decorateRequest('actor', null);
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const internalToken = readHeader(request, SAP_INTERNAL_ORCHESTRATION_HEADER_V1F2);
  if (internalToken) {
    if (
      !isAllowedSapInternalOrchestrationPathV1f2(request.method, request.raw.url)
      || !matchesSapInternalOrchestrationSecretV1f2(internalToken)
    ) {
      await reply.code(401).send({ error: 'unauthorized_internal_orchestration' });
      return;
    }
    const internalTenantId = getTenantHeader(request);
    const internalUserId = readHeader(request, SAP_INTERNAL_OWNER_HEADER_V1F2);
    if (
      !internalTenantId
      || !internalUserId
      || !isUuidV1f2(internalTenantId)
      || !isUuidV1f2(internalUserId)
    ) {
      await reply.code(400).send({ error: 'invalid_internal_orchestration_actor' });
      return;
    }
    request.authPrincipal = {
      provider: 'INTERNAL_AUTOMATION',
      issuer: 'bridata://internal/sap-orchestration-v1f2',
      subject: internalUserId,
      internalUserId,
      internalTenantId,
    };
    return;
  }

  if (config.AUTH_MODE === 'dev') {
    request.authPrincipal = {
      provider: 'DEV',
      issuer: 'bridata://dev',
      subject: config.DEV_USER_ID!,
      devUserId: config.DEV_USER_ID!,
      devTenantId: config.DEV_TENANT_ID!,
    };
    return;
  }

  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) {
    await reply.code(401).send({
      error: 'unauthorized',
      message: 'A bearer token is required.',
    });
    return;
  }

  const token = authorization.slice('Bearer '.length).trim();

  try {
    // Phase 1: read tid only to determine which tenant-specific issuer
    // must be cryptographically validated. No authorization occurs here.
    const unverified = decodeJwt(token);
    const unverifiedTenantId =
      typeof unverified.tid === 'string' ? unverified.tid : undefined;

    const unverifiedTenantContext = validateEntraTenantClaims({
      tenantId: unverifiedTenantId,
      configuredTenantId: config.ENTRA_TENANT_ID,
    });

    const { payload } = await jwtVerify(
      token,
      getEntraJwksForTenant(unverifiedTenantContext.tenantId),
      {
        audience: config.ENTRA_API_CLIENT_ID!,
        issuer: unverifiedTenantContext.issuer,
        clockTolerance: 5,
      },
    );

    const delegatedScopes =
      typeof payload.scp === 'string'
        ? payload.scp.split(' ').map((scope) => scope.trim()).filter(Boolean)
        : [];

    // Phase 2: only trusted, cryptographically verified claims are used
    // for the authenticated Bridata principal.
    const verifiedTenantContext = validateEntraTenantClaims({
      tenantId: typeof payload.tid === 'string' ? payload.tid : undefined,
      configuredTenantId: config.ENTRA_TENANT_ID,
      issuer: typeof payload.iss === 'string' ? payload.iss : undefined,
      scopes: delegatedScopes,
      requiredScope: config.ENTRA_REQUIRED_SCOPE,
    });

    if (verifiedTenantContext.tenantId !== unverifiedTenantContext.tenantId) {
      throw new Error('Verified Entra tenant does not match token tenant.');
    }

    const entraTenantId = verifiedTenantContext.tenantId;
    const issuer = verifiedTenantContext.issuer;

    const subject =
      typeof payload.oid === 'string'
        ? payload.oid
        : typeof payload.sub === 'string'
          ? payload.sub
          : undefined;

    if (!subject) {
      throw new Error('Token does not contain oid or sub.');
    }

    request.authPrincipal = {
      provider: 'ENTRA_ID',
      issuer,
      subject,
      providerTenantId: entraTenantId,
      ...(typeof payload.preferred_username === 'string'
        ? { email: payload.preferred_username }
        : typeof payload.email === 'string'
          ? { email: payload.email }
          : {}),
      ...(typeof payload.name === 'string' ? { name: payload.name } : {}),
    };
  } catch (error) {
    request.log.warn({ err: error }, 'Entra token validation failed');
    await reply.code(401).send({
      error: 'unauthorized',
      message: 'The access token is invalid, expired, or not authorized for this API.',
    });
  }
}

export async function resolveAuthenticatedUser(
  principal: AuthPrincipal,
): Promise<AuthenticatedUser | null> {
  if (principal.provider === 'DEV') {
    return prisma.user.findUnique({
      where: { id: principal.devUserId! },
      select: {
        id: true,
        email: true,
        fullName: true,
        avatarUrl: true,
        isActive: true,
      },
    });
  }

  if (principal.provider === 'INTERNAL_AUTOMATION') {
    return null;
  }

  const identity = await prisma.userIdentity.findUnique({
    where: {
      provider_issuer_subject: {
        provider: 'ENTRA_ID',
        issuer: principal.issuer,
        subject: principal.subject,
      },
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          fullName: true,
          avatarUrl: true,
          isActive: true,
        },
      },
    },
  });

  return identity?.user ?? null;
}

function readHeader(request: FastifyRequest, name: string): string | undefined {
  const raw = request.headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

function getTenantHeader(request: FastifyRequest): string | undefined {
  return (
    readHeader(request, 'x-bridata-tenant-id') ||
    readHeader(request, 'x-nexus-tenant-id')
  );
}

export async function resolveActor(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const principal = request.authPrincipal;
  if (!principal) {
    await reply.code(401).send({ error: 'unauthorized' });
    return;
  }

  if (principal.provider === 'DEV') {
    const tenantId = principal.devTenantId!;
    const userId = principal.devUserId!;
    const membership = await withTenant(tenantId, (tx) =>
      tx.tenantMembership.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
        include: { user: true },
      }),
    );

    if (!membership || membership.status !== 'ACTIVE' || !membership.user.isActive) {
      await reply.code(403).send({
        error: 'forbidden',
        message: 'The development actor is not an active tenant member.',
      });
      return;
    }

    request.actor = {
      tenantId,
      userId,
      membershipId: membership.id,
      role: membership.role,
      email: membership.user.email,
      name: membership.user.fullName,
    };
    return;
  }

  if (principal.provider === 'INTERNAL_AUTOMATION') {
    const tenantId = principal.internalTenantId!;
    const userId = principal.internalUserId!;
    const membership = await withTenant(tenantId, (tx) =>
      tx.tenantMembership.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
        include: { user: true },
      }),
    );
    if (
      !membership
      || membership.status !== 'ACTIVE'
      || !membership.user.isActive
      || (membership.role !== 'OWNER' && membership.role !== 'TENANT_ADMIN')
    ) {
      await reply.code(403).send({
        error: 'internal_automation_owner_not_authorized',
        message: 'The configured SAP automation owner must remain an active tenant administrator.',
      });
      return;
    }
    request.actor = {
      tenantId,
      userId,
      membershipId: membership.id,
      role: membership.role,
      email: membership.user.email,
      name: membership.user.fullName,
    };
    return;
  }

  const tenantId = getTenantHeader(request);
  if (!tenantId) {
    await reply.code(400).send({
      error: 'tenant_required',
      message: 'x-bridata-tenant-id is required for tenant-scoped requests.',
    });
    return;
  }

  const user = await resolveAuthenticatedUser(principal);
  if (!user || !user.isActive) {
    await reply.code(403).send({
      error: 'identity_not_provisioned',
      message: 'This Microsoft identity is not provisioned in Bridata Project.',
    });
    return;
  }

  const membership = await withTenant(tenantId, (tx) =>
    tx.tenantMembership.findUnique({
      where: {
        tenantId_userId: {
          tenantId,
          userId: user.id,
        },
      },
    }),
  );

  if (!membership || membership.status !== 'ACTIVE') {
    await reply.code(403).send({
      error: 'tenant_access_denied',
      message: 'The authenticated user is not an active member of this Bridata Project tenant.',
    });
    return;
  }

  request.actor = {
    tenantId,
    userId: user.id,
    membershipId: membership.id,
    role: membership.role,
    email: user.email,
    name: user.fullName,
  };
}

export function requireTenantRoles(...allowedRoles: string[]) {
  return async function tenantRoleGuard(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (!request.actor || !allowedRoles.includes(request.actor.role)) {
      await reply.code(403).send({
        error: 'forbidden',
        message: 'Your tenant role does not permit this operation.',
      });
    }
  };
}
