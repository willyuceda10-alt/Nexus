import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canManageWorkspacePermissions } from '../authorization.js';
import { withTenant } from '../tenant-transaction.js';

const paramsSchema = z.object({ workspaceId: z.string().uuid() });

export async function workspaceMembersV1Routes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/workspaces/:workspaceId/members-v1',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'validation_error', details: params.error.flatten() });
      }

      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const workspace = await tx.workspace.findFirst({
          where: { id: params.data.workspaceId, tenantId: actor.tenantId },
          select: { id: true, name: true },
        });
        if (!workspace) return { kind: 'not_found' as const };
        if (!(await canManageWorkspacePermissions(tx, actor, workspace.id))) {
          return { kind: 'forbidden' as const };
        }

        const members = await tx.workspaceMember.findMany({
          where: { tenantId: actor.tenantId, workspaceId: workspace.id },
          select: {
            id: true,
            userId: true,
            role: true,
            createdAt: true,
            user: {
              select: {
                fullName: true,
                email: true,
                avatarUrl: true,
                isActive: true,
              },
            },
          },
        });

        return {
          kind: 'ok' as const,
          payload: {
            workspace: { id: workspace.id, name: workspace.name },
            roles: ['OWNER', 'ADMIN', 'PMO_SENIOR', 'MANAGER', 'MEMBER', 'VIEWER'] as const,
            items: members
              .map((member) => ({
                membershipId: member.id,
                userId: member.userId,
                fullName: member.user.fullName,
                email: member.user.email,
                avatarUrl: member.user.avatarUrl,
                isActive: member.user.isActive,
                role: String(member.role),
                joinedAt: member.createdAt.toISOString(),
              }))
              .sort((left, right) => left.fullName.localeCompare(right.fullName, 'es')),
          },
        };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'workspace_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_permission_management_denied' });
      return result.payload;
    },
  );
}
