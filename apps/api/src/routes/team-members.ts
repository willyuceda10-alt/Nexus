import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, resolveActor, requireTenantRoles } from '../auth.js';
import { withTenant } from '../tenant-transaction.js';

const inviteSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email(),
  role: z.enum(['TENANT_ADMIN', 'MEMBER', 'GUEST']).default('MEMBER'),
});

const membershipParamsSchema = z.object({
  membershipId: z.string().uuid(),
});

export async function teamMemberRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/team/members',
    { preHandler: [authenticate, resolveActor] },
    async (request) => {
      const actor = request.actor!;
      const members = await withTenant(actor.tenantId, (tx) =>
        tx.tenantMembership.findMany({
          where: { tenantId: actor.tenantId },
          select: {
            id: true,
            role: true,
            status: true,
            createdAt: true,
            user: { select: { id: true, email: true, fullName: true, avatarUrl: true, isActive: true } },
          },
          orderBy: { createdAt: 'asc' },
        }),
      );
      return { members };
    },
  );

  app.post(
    '/api/v1/team/invitations',
    { preHandler: [authenticate, resolveActor, requireTenantRoles('OWNER', 'TENANT_ADMIN')] },
    async (request, reply) => {
      const parsed = inviteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation_error',
          details: parsed.error.flatten(),
        });
      }

      const { email, role } = parsed.data;
      const actor = request.actor!;

      // The whole invite is one transaction so a failed membership write can never
      // leave behind an orphan User row that no tenant can see or clean up. `users`
      // is not RLS-protected, so it is reachable from inside the tenant context.
      const outcome = await withTenant(actor.tenantId, async (tx) => {
        const existingUser = await tx.user.findFirst({
          where: { email: { equals: email, mode: 'insensitive' } },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });

        const invitee = existingUser
          ?? (await tx.user.create({
            data: { email, fullName: email.split('@')[0] ?? email, isActive: true },
            select: { id: true },
          }));

        const existing = await tx.tenantMembership.findUnique({
          where: { tenantId_userId: { tenantId: actor.tenantId, userId: invitee.id } },
        });

        if (existing?.status === 'ACTIVE') {
          return { conflict: true as const };
        }

        const membership = existing
          ? await tx.tenantMembership.update({
              where: { id: existing.id },
              data: { role, status: 'INVITED' },
            })
          : await tx.tenantMembership.create({
              data: { tenantId: actor.tenantId, userId: invitee.id, role, status: 'INVITED' },
            });

        return { conflict: false as const, membership };
      });

      if (outcome.conflict) {
        return reply.code(409).send({
          error: 'already_member',
          message: 'This person is already an active member of your tenant.',
        });
      }

      return reply.code(201).send({
        invitation: {
          id: outcome.membership.id,
          email,
          role: outcome.membership.role,
          status: outcome.membership.status,
        },
      });
    },
  );

  app.delete(
    '/api/v1/team/invitations/:membershipId',
    { preHandler: [authenticate, resolveActor, requireTenantRoles('OWNER', 'TENANT_ADMIN')] },
    async (request, reply) => {
      const parsed = membershipParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'validation_error',
          details: parsed.error.flatten(),
        });
      }

      const actor = request.actor!;
      // deleteMany scopes the delete to this tenant and to a still-pending
      // invitation in one statement, so a concurrent accept yields count 0
      // instead of racing a read against a delete.
      const deleted = await withTenant(actor.tenantId, (tx) =>
        tx.tenantMembership.deleteMany({
          where: {
            id: parsed.data.membershipId,
            tenantId: actor.tenantId,
            status: 'INVITED',
          },
        }),
      );

      if (deleted.count === 0) {
        return reply.code(404).send({ error: 'invitation_not_found' });
      }
      return reply.code(204).send();
    },
  );
}
