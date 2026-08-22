import type { FastifyInstance } from 'fastify';
import { authenticate, resolveActor } from '../auth.js';
import { withTenant } from '../tenant-transaction.js';

export async function bootstrapRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/bootstrap',
    { preHandler: [authenticate, resolveActor] },
    async (request) => {
      const actor = request.actor!;

      return withTenant(actor.tenantId, async (tx) => {
        const [tenant, workspaces, objectDefinitions] = await Promise.all([
          tx.tenant.findUniqueOrThrow({
            where: { id: actor.tenantId },
            select: {
              id: true,
              name: true,
              slug: true,
              plan: true,
              status: true,
              metadata: true,
            },
          }),
          tx.workspace.findMany({
            where: {
              tenantId: actor.tenantId,
              memberships: {
                some: {
                  userId: actor.userId,
                },
              },
            },
            select: {
              id: true,
              name: true,
              code: true,
              description: true,
              memberships: {
                where: { userId: actor.userId },
                select: { role: true },
                take: 1,
              },
            },
            orderBy: { name: 'asc' },
          }),
          tx.objectDefinition.findMany({
            where: { tenantId: actor.tenantId },
            select: {
              id: true,
              key: true,
              name: true,
              description: true,
              icon: true,
              schema: true,
              permissions: true,
              isSystem: true,
            },
            orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
          }),
        ]);

        return {
          product: {
            name: 'Bridata Project',
            apiVersion: 'v1',
          },
          actor,
          tenant,
          workspaces: workspaces.map(({ memberships, ...workspace }) => ({
            ...workspace,
            role: memberships[0]?.role ?? 'MEMBER',
          })),
          objectDefinitions,
        };
      });
    },
  );
}
