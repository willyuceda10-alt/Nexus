import type { FastifyInstance } from 'fastify';
import {
  authenticate,
  resolveAuthenticatedUser,
} from '../auth.js';
import { activatePendingInvitations, resolveOrProvisionEntraUser } from '../auto-provision.js';
import {
  withAuthenticatedUser,
  withTenant,
} from '../tenant-transaction.js';

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/session',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const principal = request.authPrincipal!;
      let user = await resolveAuthenticatedUser(principal);

      if (!user && principal.provider === 'ENTRA_ID') {
        user = await resolveOrProvisionEntraUser(principal);
      } else if (user) {
        // A returning user already has an identity, so they never pass through the
        // link-on-first-login path. Pending invitations must still be honoured here
        // or they would stay INVITED forever.
        await activatePendingInvitations(user.id);
      }

      if (!user || !user.isActive) {
        return reply.code(403).send({
          error: 'identity_not_provisioned',
          message: 'This authenticated identity is not provisioned in Bridata Project.',
        });
      }

      const memberships = await withAuthenticatedUser(user.id, (tx) =>
        tx.tenantMembership.findMany({
          where: {
            userId: user.id,
            status: 'ACTIVE',
          },
          select: {
            id: true,
            tenantId: true,
            role: true,
          },
          orderBy: { createdAt: 'asc' },
        }),
      );

      // One transaction per membership would open N pooled connections concurrently
      // and exhaust the pool for anyone in more than a handful of tenants. The
      // tenant_isolation RLS policy is scoped per tenant id, so read each row under
      // its own tenant context but sequentially, holding one connection at a time.
      const tenants: Array<{
        id: string;
        name: string;
        slug: string;
        plan: string;
        status: string;
        metadata: unknown;
        membershipId: string;
        role: string;
      }> = [];

      for (const membership of memberships) {
        const tenant = await withTenant(membership.tenantId, (tx) =>
          tx.tenant.findUnique({
            where: { id: membership.tenantId },
            select: {
              id: true,
              name: true,
              slug: true,
              plan: true,
              status: true,
              metadata: true,
            },
          }),
        );

        if (!tenant || tenant.status !== 'ACTIVE') continue;
        tenants.push({
          ...tenant,
          membershipId: membership.id,
          role: membership.role,
        });
      }

      const preferredTenantId =
        principal.provider === 'DEV' &&
        principal.devTenantId &&
        tenants.some((tenant) => tenant.id === principal.devTenantId)
          ? principal.devTenantId
          : tenants.length === 1
            ? tenants[0]!.id
            : null;

      return {
        product: {
          name: 'Bridata Project',
          apiVersion: 'v1',
        },
        identity: {
          provider: principal.provider,
          providerTenantId: principal.providerTenantId ?? null,
        },
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          avatarUrl: user.avatarUrl,
        },
        tenants,
        preferredTenantId,
      };
    },
  );
}
