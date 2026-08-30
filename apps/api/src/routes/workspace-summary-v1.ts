import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canAccessWorkspace } from '../authorization.js';
import { withTenant } from '../tenant-transaction.js';

const paramsSchema = z.object({ workspaceId: z.string().uuid() });

type SummaryRow = {
  total_objects: bigint;
  total_projects: bigint;
  active_projects: bigint;
  completed_projects: bigint;
  average_project_progress: number | null;
  open_work_items: bigint;
  my_open_work_items: bigint;
  blocked_items: bigint;
  attention_items: bigint;
  critical_risks: bigint;
  overdue_items: bigint;
  due_next_14_days: bigint;
};

type ApprovalRow = { pending_approvals: bigint };

function asNumber(value: bigint | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

export async function workspaceSummaryV1Routes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/workspaces/:workspaceId/summary-v1',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'validation_error', details: params.error.flatten() });
      }

      const actor = request.actor!;
      const workspaceId = params.data.workspaceId;

      const result = await withTenant(actor.tenantId, async (tx) => {
        if (!(await canAccessWorkspace(tx, actor, workspaceId))) {
          return { kind: 'forbidden' as const };
        }

        const [rows, approvalRows] = await Promise.all([
          tx.$queryRaw<SummaryRow[]>(Prisma.sql`
            WITH scoped_objects AS (
              SELECT
                o.*,
                (
                  o.object_type_key = 'RISK'
                  AND o.status NOT IN ('CLOSED','CANCELLED')
                  AND (
                    o.priority = 'CRITICAL'
                    OR CASE
                      WHEN COALESCE(o.metadata->>'riskScore', '') ~ '^[0-9]+([.][0-9]+)?$'
                        THEN (o.metadata->>'riskScore')::numeric >= 15
                      ELSE false
                    END
                  )
                ) AS is_critical_risk
              FROM nexus_objects o
              WHERE o.tenant_id = ${actor.tenantId}::uuid
                AND o.workspace_id = ${workspaceId}::uuid
                AND o.deleted_at IS NULL
            )
            SELECT
              COUNT(*)::bigint AS total_objects,
              COUNT(*) FILTER (WHERE object_type_key = 'PROJECT')::bigint AS total_projects,
              COUNT(*) FILTER (
                WHERE object_type_key = 'PROJECT'
                  AND status NOT IN ('COMPLETED', 'CANCELLED', 'APPROVED')
              )::bigint AS active_projects,
              COUNT(*) FILTER (
                WHERE object_type_key = 'PROJECT'
                  AND status IN ('COMPLETED', 'APPROVED')
              )::bigint AS completed_projects,
              AVG(progress) FILTER (
                WHERE object_type_key = 'PROJECT'
                  AND status NOT IN ('COMPLETED', 'CANCELLED', 'APPROVED')
              )::float8 AS average_project_progress,
              COUNT(*) FILTER (
                WHERE object_type_key IN ('TASK','MILESTONE','DELIVERABLE','CHANGE_REQUEST','RISK')
                  AND status NOT IN ('COMPLETED','CANCELLED','APPROVED','CLOSED')
              )::bigint AS open_work_items,
              COUNT(*) FILTER (
                WHERE object_type_key IN ('TASK','MILESTONE','DELIVERABLE','CHANGE_REQUEST','RISK')
                  AND status NOT IN ('COMPLETED','CANCELLED','APPROVED','CLOSED')
                  AND (assignee_id = ${actor.userId}::uuid OR owner_id = ${actor.userId}::uuid)
              )::bigint AS my_open_work_items,
              COUNT(*) FILTER (WHERE status = 'BLOCKED')::bigint AS blocked_items,
              COUNT(*) FILTER (
                WHERE status = 'BLOCKED' OR is_critical_risk
              )::bigint AS attention_items,
              COUNT(*) FILTER (WHERE is_critical_risk)::bigint AS critical_risks,
              COUNT(*) FILTER (
                WHERE due_date < CURRENT_TIMESTAMP
                  AND status NOT IN ('COMPLETED','CANCELLED','APPROVED','CLOSED')
              )::bigint AS overdue_items,
              COUNT(*) FILTER (
                WHERE due_date >= CURRENT_TIMESTAMP
                  AND due_date < CURRENT_TIMESTAMP + INTERVAL '14 days'
                  AND status NOT IN ('COMPLETED','CANCELLED','APPROVED','CLOSED')
              )::bigint AS due_next_14_days
            FROM scoped_objects
          `),
          tx.$queryRaw<ApprovalRow[]>(Prisma.sql`
            SELECT COUNT(*)::bigint AS pending_approvals
            FROM object_approval_requests_v1 a
            INNER JOIN nexus_objects o
              ON o.id = a.object_id
             AND o.tenant_id = a.tenant_id
            WHERE a.tenant_id = ${actor.tenantId}::uuid
              AND o.workspace_id = ${workspaceId}::uuid
              AND a.status = 'PENDING'
              AND o.deleted_at IS NULL
          `),
        ]);

        const row = rows[0];
        const approvalRow = approvalRows[0];
        return {
          kind: 'ok' as const,
          summary: {
            workspaceId,
            totalObjects: asNumber(row?.total_objects),
            projects: {
              total: asNumber(row?.total_projects),
              active: asNumber(row?.active_projects),
              completed: asNumber(row?.completed_projects),
              averageProgress: Math.round(row?.average_project_progress ?? 0),
            },
            work: {
              open: asNumber(row?.open_work_items),
              mine: asNumber(row?.my_open_work_items),
              blocked: asNumber(row?.blocked_items),
              attention: asNumber(row?.attention_items),
              overdue: asNumber(row?.overdue_items),
              dueNext14Days: asNumber(row?.due_next_14_days),
            },
            risk: {
              critical: asNumber(row?.critical_risks),
            },
            approvals: {
              pending: asNumber(approvalRow?.pending_approvals),
            },
            generatedAt: new Date().toISOString(),
          },
        };
      });

      if (result.kind === 'forbidden') {
        return reply.code(403).send({ error: 'workspace_access_denied' });
      }
      return result.summary;
    },
  );
}
