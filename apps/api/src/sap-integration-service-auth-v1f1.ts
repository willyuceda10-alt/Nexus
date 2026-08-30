import type { FastifyReply, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import { z } from 'zod';
import { config } from './config.js';
import {
  SAP_INTEGRATION_IMPORT_APP_ROLE_V1F1,
  hasIntegrationImportRoleV1f1,
  serviceClientIdV1f1,
} from './domain/sap-service-auth-v1f1.js';
import { withTenant } from './tenant-transaction.js';

const uuid = z.string().uuid();
const jwksTenant = config.ENTRA_TENANT_ID ?? 'common';
const entraJwksV1f1 = createRemoteJWKSet(
  new URL(`https://login.microsoftonline.com/${jwksTenant}/discovery/v2.0/keys`),
);

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export type SapIntegrationServiceActorV1f1 = {
  tenantId: string;
  connectionId: string;
  servicePrincipalId: string;
  clientId: string;
  displayName: string;
  allowedSourceKeys: string[];
  authMode: 'DEV_SERVICE' | 'ENTRA_CLIENT_CREDENTIALS';
};

async function loadRegisteredServiceActor(
  tenantId: string,
  connectionId: string,
  clientId: string,
  authMode: SapIntegrationServiceActorV1f1['authMode'],
): Promise<SapIntegrationServiceActorV1f1 | null> {
  return withTenant(tenantId, async (tx) => {
    const connection = await tx.integrationConnection.findFirst({
      where: { id: connectionId, tenantId, provider: 'SAP' },
      select: { id: true, status: true },
    });
    if (!connection || connection.status === 'DISCONNECTED') return null;

    const principal = await tx.integrationServicePrincipal.findFirst({
      where: {
        tenantId,
        integrationConnectionId: connectionId,
        clientId,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        clientId: true,
        displayName: true,
        allowedSourceKeys: true,
      },
    });
    if (!principal) return null;
    return {
      tenantId,
      connectionId,
      servicePrincipalId: principal.id,
      clientId: principal.clientId,
      displayName: principal.displayName,
      allowedSourceKeys: principal.allowedSourceKeys,
      authMode,
    };
  });
}

export async function authenticateSapIntegrationServiceV1f1(
  request: FastifyRequest,
  reply: FastifyReply,
  connectionId: string,
): Promise<SapIntegrationServiceActorV1f1 | null> {
  if (!uuid.safeParse(connectionId).success) {
    await reply.code(400).send({ error: 'validation_error' });
    return null;
  }

  const tenantId = header(request, 'x-bridata-tenant-id');
  if (!tenantId || !uuid.safeParse(tenantId).success) {
    await reply.code(400).send({
      error: 'tenant_required',
      message: 'x-bridata-tenant-id is required for integration service requests.',
    });
    return null;
  }

  if (config.AUTH_MODE === 'dev') {
    const clientId = header(request, 'x-bridata-service-client-id');
    if (!clientId || !uuid.safeParse(clientId).success) {
      await reply.code(401).send({ error: 'service_client_id_required' });
      return null;
    }
    const actor = await loadRegisteredServiceActor(tenantId, connectionId, clientId, 'DEV_SERVICE');
    if (!actor) {
      await reply.code(403).send({ error: 'integration_service_principal_not_authorized' });
      return null;
    }
    return actor;
  }

  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) {
    await reply.code(401).send({ error: 'unauthorized', message: 'A bearer token is required.' });
    return null;
  }

  try {
    const token = authorization.slice('Bearer '.length).trim();
    const decoded = decodeJwt(token);
    const entraTenantId = typeof decoded.tid === 'string' ? decoded.tid : null;
    if (!entraTenantId || entraTenantId !== config.ENTRA_TENANT_ID) {
      throw new Error('Unexpected or missing Entra tenant id.');
    }
    const issuer = `https://login.microsoftonline.com/${config.ENTRA_TENANT_ID}/v2.0`;
    const { payload } = await jwtVerify(token, entraJwksV1f1, {
      audience: config.ENTRA_API_CLIENT_ID!,
      issuer,
      clockTolerance: 5,
    });
    if (!hasIntegrationImportRoleV1f1(payload, SAP_INTEGRATION_IMPORT_APP_ROLE_V1F1)) {
      throw new Error('Application token does not contain the required integration import app role.');
    }
    const clientId = serviceClientIdV1f1(payload);
    if (!clientId || !uuid.safeParse(clientId).success) {
      throw new Error('Application token does not contain a valid azp/appid client id.');
    }
    const actor = await loadRegisteredServiceActor(
      tenantId,
      connectionId,
      clientId,
      'ENTRA_CLIENT_CREDENTIALS',
    );
    if (!actor) {
      await reply.code(403).send({ error: 'integration_service_principal_not_authorized' });
      return null;
    }
    return actor;
  } catch (error) {
    request.log.warn({ err: error }, 'SAP integration service token validation failed');
    await reply.code(401).send({
      error: 'unauthorized',
      message: 'The application access token is invalid or lacks the required app role.',
    });
    return null;
  }
}
