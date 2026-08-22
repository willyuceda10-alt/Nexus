import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import { config } from './config.js';
import { prisma } from './db.js';

export type AuthProvider = 'ENTRA_ID' | 'DEV';

export interface AuthPrincipal {
  provider: AuthProvider;
  issuer: string;
  subject: string;
  providerTenantId?: string;
  email?: string;
  name?: string;
  devUserId?: string;
  devTenantId?: string;
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

const entraJwks = createRemoteJWKSet(
  new URL('https://login.microsoftonline.com/common/discovery/v2.0/keys'),
);

export function registerRequestContext(app: FastifyInstance): void {
  app.decorateRequest('authPrincipal', null);
  app.decorateRequest('actor', null);
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
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
    const unverified = decodeJwt(token);
    const entraTenantId = typeof unverified.tid === 'string' ? unverified.tid : undefined;
    if (!entraTenantId) {
      throw new Error('Token does not contain an Entra tenant id (tid).');
    }

    const issuer = `https://login.microsoftonline.com/${entraTenantId}/v2.0`;
    const { payload } = await jwtVerify(token, entraJwks, {
      audience: config.ENTRA_CLIENT_ID!,
      issuer,
      clockTolerance: 5,
    });

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
      message: 'The access token is invalid or expired.',
    });
  }
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
    const membership = await prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      include: { user: true },
    });

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

  const tenantId = getTenantHeader(request);
  if (!tenantId) {
    await reply.code(400).send({
      error: 'tenant_required',
      message: 'x-bridata-tenant-id is required for tenant-scoped requests.',
    });
    return;
  }

  const identity = await prisma.userIdentity.findUnique({
    where: {
      provider_issuer_subject: {
        provider: 'ENTRA_ID',
        issuer: principal.issuer,
        subject: principal.subject,
      },
    },
    include: { user: true },
  });

  if (!identity || !identity.user.isActive) {
    await reply.code(403).send({
      error: 'identity_not_provisioned',
      message: 'This Microsoft identity is not provisioned in Bridata Project.',
    });
    return;
  }

  const membership = await prisma.tenantMembership.findUnique({
    where: {
      tenantId_userId: {
        tenantId,
        userId: identity.userId,
      },
    },
  });

  if (!membership || membership.status !== 'ACTIVE') {
    await reply.code(403).send({
      error: 'tenant_access_denied',
      message: 'The authenticated user is not an active member of this Bridata Project tenant.',
    });
    return;
  }

  request.actor = {
    tenantId,
    userId: identity.userId,
    membershipId: membership.id,
    role: membership.role,
    email: identity.user.email,
    name: identity.user.fullName,
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
