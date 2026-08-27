import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canAccessWorkspace } from '../authorization.js';
import { withTenant } from '../tenant-transaction.js';

const querySchema = z.object({ workspaceId: z.string().uuid() });

export async function meetingPeopleV1Routes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/meetings-v1/people',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const query = querySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({
          error: 'validation_error',
          details: query.error.flatten(),
        });
      }

      const actor = request.actor!;
      return withTenant(actor.tenantId, async (tx) => {
        if (!(await canAccessWorkspace(tx, actor, query.data.workspaceId))) {
          return reply.code(403).send({ error: 'workspace_access_denied' });
        }

        const members = await tx.workspaceMember.findMany({
          where: {
            tenantId: actor.tenantId,
            workspaceId: query.data.workspaceId,
            user: {
              isActive: true,
              tenantMemberships: {
                some: { tenantId: actor.tenantId, status: 'ACTIVE' },
              },
            },
          },
          select: {
            role: true,
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
                avatarUrl: true,
              },
            },
          },
          orderBy: [
            { role: 'asc' },
            { user: { fullName: 'asc' } },
          ],
        });

        return {
          items: members.map((member) => ({
            id: member.user.id,
            fullName: member.user.fullName,
            email: member.user.email,
            avatarUrl: member.user.avatarUrl,
            workspaceRole: member.role,
            isCurrentUser: member.user.id === actor.userId,
          })),
        };
      });
    },
  );
}
