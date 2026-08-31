import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canAccessWorkspace } from '../authorization.js';
import { calculateBudgetLineForecastV2, calculateProjectCostSummaryV2 } from '../domain/cost-engine-v2.js';
import { buildSapFinancialForecastV1g6 } from '../domain/sap-financial-forecast-v1g6.js';
import { withTenant } from '../tenant-transaction.js';
import { tenantCurrency, validProject } from './cost-engine-v2-utils.js';

const projectParams = z.object({ projectId: z.string().uuid() });

type Money = Prisma.Decimal | string | number;
type BudgetLineRow = {
  id: string;
  work_item_object_id: string | null;
  work_item_title: string | null;
  cost_code_id: string;
  cost_code: string;
  cost_code_name: string;
  material_id: string | null;
  material_name: string | null;
  description: string;
  planned_amount: Money;
  approved_amount: Money;
  forecast_remaining_uncommitted: Money | null;
};
type FactRow = {
  id: string;
  work_item_object_id: string | null;
  cost_code_id: string | null;
  material_id: string | null;
  amount: Money;
  currency: string | null;
};
type ProfileRow = { id: string; currency: string; contingency_amount: Money };

type Fact = {
  id: string;
  workItemId: string | null;
  costCodeId: string | null;
  materialId: string | null;
  amount: number;
  source: 'MANUAL_ACTUAL' | 'MATERIAL_ACTUAL' | 'MANUAL_COMMITMENT' | 'MATERIAL_COMMITMENT';
};

function numberOf(value: Money | null | undefined): number {
  return value == null ? 0 : Number(value);
}

function allocateFact(fact: Fact, lines: BudgetLineRow[]): string | null {
  const match = (predicate: (line: BudgetLineRow) => boolean): string | null => {
    const candidates = lines.filter(predicate);
    return candidates.length === 1 ? candidates[0]!.id : null;
  };

  if (fact.materialId && fact.workItemId) {
    const exact = match((line) => line.material_id === fact.materialId && line.work_item_object_id === fact.workItemId);
    if (exact) return exact;
  }
  if (fact.materialId) {
    const material = match((line) => line.material_id === fact.materialId);
    if (material) return material;
  }
  if (fact.costCodeId && fact.workItemId) {
    const exact = match((line) => line.cost_code_id === fact.costCodeId && line.work_item_object_id === fact.workItemId);
    if (exact) return exact;
  }
  if (fact.costCodeId) {
    const code = match((line) => line.cost_code_id === fact.costCodeId);
    if (code) return code;
  }
  return null;
}

export async function costOverviewV2Routes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/projects/:projectId/cost-overview-v2',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const params = projectParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'validation_error' });
      const actor = request.actor!;

      const result = await withTenant(actor.tenantId, async (tx) => {
        const project = await validProject(tx, actor.tenantId, params.data.projectId);
        if (!project) return { kind: 'not_found' as const };
        if (!(await canAccessWorkspace(tx, actor, project.workspaceId))) return { kind: 'forbidden' as const };

        const [profiles, tenant] = await Promise.all([
          tx.$queryRaw<ProfileRow[]>(Prisma.sql`
            SELECT id, currency, contingency_amount FROM project_cost_profiles
            WHERE tenant_id = ${actor.tenantId}::uuid AND project_object_id = ${project.id}::uuid
          `),
          tx.tenant.findUnique({ where: { id: actor.tenantId }, select: { metadata: true } }),
        ]);
        const profile = profiles[0] ?? null;
        const currency = profile?.currency ?? tenantCurrency(tenant?.metadata ?? null);

        const lines = await tx.$queryRaw<BudgetLineRow[]>(Prisma.sql`
          SELECT bl.id, bl.work_item_object_id, wi.title AS work_item_title,
                 bl.cost_code_id, cc.code AS cost_code, cc.name AS cost_code_name,
                 bl.material_id, mo.title AS material_name, bl.description,
                 bl.planned_amount, bl.approved_amount, bl.forecast_remaining_uncommitted
          FROM project_budget_lines bl
          JOIN cost_codes cc ON cc.id = bl.cost_code_id
          LEFT JOIN nexus_objects wi ON wi.id = bl.work_item_object_id
          LEFT JOIN material_masters mm ON mm.id = bl.material_id
          LEFT JOIN nexus_objects mo ON mo.id = mm.material_object_id
          WHERE bl.tenant_id = ${actor.tenantId}::uuid
            AND bl.project_object_id = ${project.id}::uuid
          ORDER BY cc.code, bl.created_at, bl.id
        `);

        const actualAuthorityRows = await tx.$queryRaw<Array<{ enabled: boolean }>>(Prisma.sql`
          SELECT EXISTS (
            SELECT 1 FROM integration_entity_links authority
            WHERE authority.tenant_id = ${actor.tenantId}::uuid
              AND authority.external_entity_type = 'SAP_ACTUAL_COST_AUTHORITY'
              AND authority.canonical_entity_type = 'PROJECT_OBJECT'
              AND authority.canonical_entity_id = ${project.id}::uuid
              AND authority.metadata->>'authority' = 'SAP_DATA_PEP'
          ) AS enabled
        `);
        const sapDataPepAuthority = Boolean(actualAuthorityRows[0]?.enabled);

        const [manualActualRows, manualCommitmentRows, materialActualRows, materialCommitmentRows] = await Promise.all([
          tx.$queryRaw<FactRow[]>(Prisma.sql`
            SELECT id, work_item_object_id, cost_code_id, material_id, amount, currency
            FROM project_actual_costs
            WHERE tenant_id = ${actor.tenantId}::uuid AND project_object_id = ${project.id}::uuid
          `),
          tx.$queryRaw<FactRow[]>(Prisma.sql`
            SELECT id, work_item_object_id, cost_code_id, NULL::uuid AS material_id,
                   GREATEST(amount - released_amount, 0) AS amount, currency
            FROM project_commitments
            WHERE tenant_id = ${actor.tenantId}::uuid
              AND project_object_id = ${project.id}::uuid
              AND status = 'OPEN' AND amount > released_amount
          `),
          tx.$queryRaw<FactRow[]>(Prisma.sql`
            SELECT grl.id,
                   mr.work_item_object_id,
                   NULL::uuid AS cost_code_id,
                   grl.material_id,
                   (grl.quantity * grl.unit_cost) AS amount,
                   po.currency
            FROM goods_receipt_lines grl
            JOIN goods_receipts gr ON gr.id = grl.goods_receipt_id
            LEFT JOIN purchase_order_lines pol ON pol.id = grl.purchase_order_line_id
            LEFT JOIN purchase_orders po_line ON po_line.id = pol.purchase_order_id
            LEFT JOIN purchase_orders po_header ON po_header.id = gr.purchase_order_id
            LEFT JOIN material_requirements mr ON mr.id = grl.requirement_id
            LEFT JOIN purchase_orders po ON po.id = COALESCE(po_line.id, po_header.id)
            WHERE grl.tenant_id = ${actor.tenantId}::uuid
              AND COALESCE(po.project_object_id, mr.project_object_id) = ${project.id}::uuid
              AND gr.status = 'POSTED'
              AND ${!sapDataPepAuthority}
          `),
          tx.$queryRaw<FactRow[]>(Prisma.sql`
            SELECT pol.id,
                   mr.work_item_object_id,
                   NULL::uuid AS cost_code_id,
                   pol.material_id,
                   (GREATEST(pol.quantity - pol.received_qty, 0) * pol.unit_cost) AS amount,
                   po.currency
            FROM purchase_order_lines pol
            JOIN purchase_orders po ON po.id = pol.purchase_order_id
            LEFT JOIN material_requirements mr ON mr.id = pol.requirement_id
            WHERE pol.tenant_id = ${actor.tenantId}::uuid
              AND COALESCE(po.project_object_id, mr.project_object_id) = ${project.id}::uuid
              AND po.status <> 'CANCELLED'
              AND pol.quantity > pol.received_qty
          `),
        ]);

        const currencyIssues: Array<{ source: string; id: string; currency: string | null }> = [];
        const toFacts = (rows: FactRow[], source: Fact['source']): Fact[] => rows.flatMap((row) => {
          if (!row.currency || row.currency !== currency) {
            currencyIssues.push({ source, id: row.id, currency: row.currency });
            return [];
          }
          return [{
            id: row.id,
            workItemId: row.work_item_object_id,
            costCodeId: row.cost_code_id,
            materialId: row.material_id,
            amount: numberOf(row.amount),
            source,
          }];
        });

        const manualActual = toFacts(manualActualRows, 'MANUAL_ACTUAL');
        const materialActual = toFacts(materialActualRows, 'MATERIAL_ACTUAL');
        const manualCommitment = toFacts(manualCommitmentRows, 'MANUAL_COMMITMENT');
        const materialCommitment = toFacts(materialCommitmentRows, 'MATERIAL_COMMITMENT');
        const allFacts = [...manualActual, ...materialActual, ...manualCommitment, ...materialCommitment];

        const actualByLine = new Map<string, number>();
        const commitmentByLine = new Map<string, number>();
        let unallocatedActual = 0;
        let unallocatedCommitment = 0;
        for (const fact of allFacts) {
          const lineId = allocateFact(fact, lines);
          const isActual = fact.source === 'MANUAL_ACTUAL' || fact.source === 'MATERIAL_ACTUAL';
          if (!lineId) {
            if (isActual) unallocatedActual += fact.amount;
            else unallocatedCommitment += fact.amount;
            continue;
          }
          const target = isActual ? actualByLine : commitmentByLine;
          target.set(lineId, (target.get(lineId) ?? 0) + fact.amount);
        }

        const lineResults = lines.map((line) => {
          const actualAmount = actualByLine.get(line.id) ?? 0;
          const commitmentAmount = commitmentByLine.get(line.id) ?? 0;
          const forecast = calculateBudgetLineForecastV2({
            approvedAmount: numberOf(line.approved_amount),
            actualAmount,
            commitmentAmount,
            forecastRemainingUncommitted: line.forecast_remaining_uncommitted == null
              ? null
              : numberOf(line.forecast_remaining_uncommitted),
          });
          return {
            id: line.id,
            workItemId: line.work_item_object_id,
            workItemTitle: line.work_item_title,
            costCodeId: line.cost_code_id,
            costCode: line.cost_code,
            costCodeName: line.cost_code_name,
            materialId: line.material_id,
            materialName: line.material_name,
            description: line.description,
            plannedAmount: numberOf(line.planned_amount),
            ...forecast,
          };
        });

        const plannedBudget = lines.reduce((sum, line) => sum + numberOf(line.planned_amount), 0);
        const approvedBudget = lines.reduce((sum, line) => sum + numberOf(line.approved_amount), 0);
        const forecastRemainingUncommitted = lineResults.reduce((sum, line) => sum + line.forecastRemainingUncommitted, 0);
        const manualActualAmount = manualActual.reduce((sum, fact) => sum + fact.amount, 0);
        const materialActualAmount = materialActual.reduce((sum, fact) => sum + fact.amount, 0);
        const manualCommitmentAmount = manualCommitment.reduce((sum, fact) => sum + fact.amount, 0);
        const materialCommitmentAmount = materialCommitment.reduce((sum, fact) => sum + fact.amount, 0);

        const summary = calculateProjectCostSummaryV2({
          plannedBudget,
          approvedBudget,
          contingencyAmount: numberOf(profile?.contingency_amount ?? 0),
          manualActual: manualActualAmount,
          materialActual: materialActualAmount,
          manualOpenCommitment: manualCommitmentAmount,
          materialOpenCommitment: materialCommitmentAmount,
          forecastRemainingUncommitted,
        });

        const latestBaseline = await tx.$queryRaw<Array<{
          id: string;
          version: number;
          captured_at: Date;
          approved_amount: Money | null;
          planned_amount: Money | null;
          contingency_amount: Money;
        }>>(Prisma.sql`
          SELECT b.id, b.version, b.captured_at, b.contingency_amount,
                 SUM(l.approved_amount) AS approved_amount,
                 SUM(l.planned_amount) AS planned_amount
          FROM project_cost_baselines b
          LEFT JOIN project_cost_baseline_lines l ON l.baseline_id = b.id
          WHERE b.tenant_id = ${actor.tenantId}::uuid AND b.project_object_id = ${project.id}::uuid
          GROUP BY b.id, b.version, b.captured_at, b.contingency_amount
          ORDER BY b.version DESC LIMIT 1
        `);
        const baseline = latestBaseline[0]
          ? {
              id: latestBaseline[0].id,
              version: latestBaseline[0].version,
              capturedAt: latestBaseline[0].captured_at.toISOString(),
              approvedBudget: numberOf(latestBaseline[0].approved_amount),
              plannedBudget: numberOf(latestBaseline[0].planned_amount),
              contingencyAmount: numberOf(latestBaseline[0].contingency_amount),
              approvedVariance: approvedBudget - numberOf(latestBaseline[0].approved_amount),
            }
          : null;

        const sapFinancialForecastV1g6 = buildSapFinancialForecastV1g6({
          controlBudget: summary.controlBudget,
          actualCost: summary.actualCost,
          openCommitment: summary.openCommitment,
          forecastRemainingUncommitted: summary.forecastRemainingUncommitted,
          estimateAtCompletion: summary.estimateAtCompletion,
          varianceAtCompletion: summary.varianceAtCompletion,
          forecastVariancePercent: summary.forecastVariancePercent,
          health: summary.health,
          baselineApprovedBudget: baseline?.approvedBudget ?? null,
          baselineContingencyAmount: baseline?.contingencyAmount ?? null,
          unallocatedActual,
          unallocatedCommitment,
          lines: lineResults.map((line) => ({
            id: line.id,
            description: line.description,
            approvedAmount: line.approvedAmount,
            actualAmount: line.actualAmount,
            commitmentAmount: line.commitmentAmount,
            forecastRemainingUncommitted: line.forecastRemainingUncommitted,
            estimateAtCompletion: line.estimateAtCompletion,
            varianceAtCompletion: line.varianceAtCompletion,
          })),
        });

        const workItemMap = new Map<string, { workItemId: string; budget: number; actual: number; commitment: number; eac: number }>();
        for (const line of lineResults) {
          if (!line.workItemId) continue;
          const current = workItemMap.get(line.workItemId) ?? { workItemId: line.workItemId, budget: 0, actual: 0, commitment: 0, eac: 0 };
          current.budget += line.approvedAmount;
          current.actual += line.actualAmount;
          current.commitment += line.commitmentAmount;
          current.eac += line.estimateAtCompletion;
          workItemMap.set(line.workItemId, current);
        }

        return {
          kind: 'ok' as const,
          payload: {
            project: { id: project.id, title: project.title, workspaceId: project.workspaceId },
            profile: profile ? { id: profile.id, currency, contingencyAmount: numberOf(profile.contingency_amount) } : null,
            currency,
            actualAuthority: sapDataPepAuthority ? 'SAP_DATA_PEP' : 'BRIDATA_MIXED',
            summary,
            sapFinancialForecastV1g6,
            lines: lineResults,
            unallocated: {
              actual: Math.round(unallocatedActual * 10_000) / 10_000,
              commitment: Math.round(unallocatedCommitment * 10_000) / 10_000,
            },
            workItems: [...workItemMap.values()].map((item) => ({
              ...item,
              varianceAtCompletion: item.budget - item.eac,
              atRisk: item.budget > 0 && item.eac > item.budget,
            })),
            baseline,
            currencyIssues,
            counts: {
              budgetLines: lines.length,
              manualActuals: manualActual.length,
              materialReceipts: materialActual.length,
              manualCommitments: manualCommitment.length,
              materialCommitments: materialCommitment.length,
            },
            calculatedAt: new Date().toISOString(),
          },
        };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'project_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
      return result.payload;
    },
  );
}
