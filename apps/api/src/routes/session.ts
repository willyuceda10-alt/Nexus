import type { FastifyInstance } from 'fastify';
import {
  authenticate,
  resolveAuthenticatedUser,
} from '../auth.js';
import { resolveOrProvisionEntraUser } from '../auto-provision.js';
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

      const tenants = (
        await Promise.all(
          memberships.map(async (membership) => {
            const tenant = await withTenant(membership.tenantId, (tx) =>
              tx.tenant.findFirst({
                where: {
                  id: membership.tenantId,
                  status: 'ACTIVE',
                },
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

            if (!tenant) return null;
            return {
              ...tenant,
              membershipId: membership.id,
              role: membership.role,
            };
          }),
        )
      ).filter((tenant): tenant is NonNullable<typeof tenant> => tenant !== null);

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
