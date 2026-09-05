import type { FastifyInstance } from 'fastify';
import type { TenantRole } from '@prisma/client';
import { authenticate, resolveActor, requireTenantRoles } from '../auth.js';
import { prisma } from '../db.js';
import { withTenant } from '../tenant-transaction.js';

const INVITABLE_ROLES: ReadonlySet<TenantRole> = new Set(['TENANT_ADMIN', 'MEMBER', 'GUEST']);

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
      const body = request.body as { email?: unknown; role?: unknown };
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const requestedRole = typeof body.role === 'string' ? body.role : 'MEMBER';

      if (!email || !email.includes('@')) {
        return reply.code(400).send({ error: 'invalid_email', message: 'A valid email is required.' });
      }
      if (!INVITABLE_ROLES.has(requestedRole as TenantRole)) {
        return reply.code(400).send({
          error: 'invalid_role',
          message: `Role must be one of: ${[...INVITABLE_ROLES].join(', ')}.`,
        });
      }
      const role = requestedRole as TenantRole;
      const actor = request.actor!;

      let invitee = await prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: { id: true, email: true, fullName: true, avatarUrl: true, isActive: true },
      });
      if (!invitee) {
        invitee = await prisma.user.create({
          data: { email, fullName: email.split('@')[0] ?? email, isActive: true },
          select: { id: true, email: true, fullName: true, avatarUrl: true, isActive: true },
        });
      }
      const inviteeId = invitee.id;

      const outcome = await withTenant(actor.tenantId, async (tx) => {
        const existing = await tx.tenantMembership.findUnique({
          where: { tenantId_userId: { tenantId: actor.tenantId, userId: inviteeId } },
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
              data: { tenantId: actor.tenantId, userId: inviteeId, role, status: 'INVITED' },
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
        invitation: { email, role: outcome.membership.role, status: outcome.membership.status },
      });
    },
  );

  app.delete(
    '/api/v1/team/invitations/:membershipId',
    { preHandler: [authenticate, resolveActor, requireTenantRoles('OWNER', 'TENANT_ADMIN')] },
    async (request, reply) => {
      const { membershipId } = request.params as { membershipId: string };
      const actor = request.actor!;

      const revoked = await withTenant(actor.tenantId, async (tx) => {
        const membership = await tx.tenantMembership.findUnique({ where: { id: membershipId } });
        if (!membership || membership.tenantId !== actor.tenantId || membership.status !== 'INVITED') {
          return null;
        }
        return tx.tenantMembership.delete({ where: { id: membershipId } });
      });

      if (!revoked) {
        return reply.code(404).send({ error: 'invitation_not_found' });
      }
      return reply.code(204).send();
    },
  );
}
