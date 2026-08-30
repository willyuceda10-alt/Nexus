import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canAccessWorkspace } from '../authorization.js';
import { withTenant } from '../tenant-transaction.js';
import { projectCostCurrency, validProject } from './cost-engine-v2-utils.js';

const querySchema = z.object({ projectId: z.string().uuid() });

type Money = Prisma.Decimal | number | string;
type JsonObject = Record<string, unknown>;

type ActualRow = {
  id: string;
  description: string;
  amount: Money;
  currency: string;
  occurred_at: Date | string;
  external_reference: string | null;
  cost_code: string | null;
  cost_code_name: string | null;
  material_code: string | null;
  material_title: string | null;
  external_key: string;
  metadata: Prisma.JsonValue | null;
};

type PrePoRow = {
  id: string;
  description: string;
  amount: Money;
  released_amount: Money;
  currency: string;
  committed_at: Date | string;
  source_reference: string | null;
  cost_code: string | null;
  cost_code_name: string | null;
  external_key: string;
  metadata: Prisma.JsonValue | null;
};

type PurchaseOrderRow = {
  id: string;
  purchase_order_id: string;
  purchase_order_number: string;
  currency: string;
  ordered_qty: Money;
  received_qty: Money;
  unit_cost: Money;
  expected_date: Date | string | null;
  supplier_code: string | null;
  supplier_name: string | null;
  material_code: string;
  material_title: string;
  external_key: string;
};

function numberOf(value: Money | null | undefined): number {
  return value == null ? 0 : Number(value);
}

function jsonObject(value: Prisma.JsonValue | null): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function dateOnly(value: Date | string | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function parsePoExternalKey(externalKey: string): { document: string | null; position: string | null } {
  const parts = externalKey.split(':');
  if (parts.length < 3 || parts[0] !== 'PO') return { document: null, position: null };
  return { document: parts[1] || null, position: parts[2] || null };
}

export async function sapFinancialViewV1g5Routes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/cost-engine-v2/sap-financial-v1g5',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const query = querySchema.safeParse(request.query);
      if (!query.success) return reply.code(400).send({ error: 'validation_error', details: query.error.flatten() });
      const actor = request.actor!;

      const result = await withTenant(actor.tenantId, async (tx) => {
        const project = await validProject(tx, actor.tenantId, query.data.projectId);
        if (!project) return { kind: 'not_found' as const };
        if (!(await canAccessWorkspace(tx, actor, project.workspaceId))) return { kind: 'forbidden' as const };

        const currency = await projectCostCurrency(tx, actor.tenantId, project.id);
        const authorityRows = await tx.$queryRaw<Array<{ enabled: boolean }>>(Prisma.sql`
          SELECT EXISTS (
            SELECT 1
            FROM integration_entity_links authority
            WHERE authority.tenant_id = ${actor.tenantId}::uuid
              AND authority.external_entity_type = 'SAP_ACTUAL_COST_AUTHORITY'
              AND authority.canonical_entity_type = 'PROJECT_OBJECT'
              AND authority.canonical_entity_id = ${project.id}::uuid
              AND authority.metadata->>'authority' = 'SAP_DATA_PEP'
          ) AS enabled
        `);
        const dataPepAuthority = Boolean(authorityRows[0]?.enabled);

        const [actualRows, prePoRows, purchaseOrderRows] = await Promise.all([
          tx.$queryRaw<ActualRow[]>(Prisma.sql`
            SELECT pac.id,
                   pac.description,
                   pac.amount,
                   pac.currency,
                   pac.occurred_at,
                   pac.external_reference,
                   cc.code AS cost_code,
                   cc.name AS cost_code_name,
                   mm.code AS material_code,
                   material_object.title AS material_title,
                   link.external_key,
                   link.metadata
            FROM project_actual_costs pac
            JOIN integration_entity_links link
              ON link.tenant_id = pac.tenant_id
             AND link.canonical_entity_type = 'PROJECT_ACTUAL_COST'
             AND link.canonical_entity_id = pac.id
             AND link.external_entity_type = 'SAP_ACTUAL_COST_PROJECTION'
            LEFT JOIN cost_codes cc ON cc.id = pac.cost_code_id
            LEFT JOIN material_masters mm ON mm.id = pac.material_id
            LEFT JOIN nexus_objects material_object ON material_object.id = mm.material_object_id
            WHERE pac.tenant_id = ${actor.tenantId}::uuid
              AND pac.project_object_id = ${project.id}::uuid
              AND pac.source_type = 'SAP_IMPORT'
            ORDER BY pac.occurred_at DESC, pac.id
          `),
          tx.$queryRaw<PrePoRow[]>(Prisma.sql`
            SELECT pc.id,
                   pc.description,
                   pc.amount,
                   pc.released_amount,
                   pc.currency,
                   pc.committed_at,
                   pc.source_reference,
                   cc.code AS cost_code,
                   cc.name AS cost_code_name,
                   link.external_key,
                   link.metadata
            FROM project_commitments pc
            JOIN integration_entity_links link
              ON link.tenant_id = pc.tenant_id
             AND link.canonical_entity_type = 'PROJECT_COMMITMENT'
             AND link.canonical_entity_id = pc.id
             AND link.external_entity_type = 'SAP_PRE_PO_COMMITMENT'
            LEFT JOIN cost_codes cc ON cc.id = pc.cost_code_id
            WHERE pc.tenant_id = ${actor.tenantId}::uuid
              AND pc.project_object_id = ${project.id}::uuid
              AND pc.source_type = 'SAP_IMPORT'
              AND pc.status = 'OPEN'
              AND pc.amount > pc.released_amount
            ORDER BY pc.committed_at DESC, pc.id
          `),
          tx.$queryRaw<PurchaseOrderRow[]>(Prisma.sql`
            SELECT pol.id,
                   po.id AS purchase_order_id,
                   po.number AS purchase_order_number,
                   po.currency,
                   pol.quantity AS ordered_qty,
                   pol.received_qty,
                   pol.unit_cost,
                   COALESCE(pol.expected_date, po.expected_date) AS expected_date,
                   supplier.code AS supplier_code,
                   supplier.name AS supplier_name,
                   mm.code AS material_code,
                   material_object.title AS material_title,
                   link.external_key
            FROM purchase_order_lines pol
            JOIN purchase_orders po ON po.id = pol.purchase_order_id
            JOIN material_masters mm ON mm.id = pol.material_id
            JOIN nexus_objects material_object ON material_object.id = mm.material_object_id
            JOIN integration_entity_links link
              ON link.tenant_id = pol.tenant_id
             AND link.canonical_entity_type = 'PURCHASE_ORDER_LINE'
             AND link.canonical_entity_id = pol.id
             AND link.external_entity_type = 'SAP_PURCHASE_ORDER_LINE'
            LEFT JOIN suppliers supplier ON supplier.id = po.supplier_id
            WHERE pol.tenant_id = ${actor.tenantId}::uuid
              AND po.project_object_id = ${project.id}::uuid
              AND po.status <> 'CANCELLED'
              AND pol.quantity > pol.received_qty
            ORDER BY COALESCE(pol.expected_date, po.expected_date) NULLS LAST, po.number, pol.id
          `),
        ]);

        const actuals = actualRows.map((row) => {
          const metadata = jsonObject(row.metadata);
          return {
            id: row.id,
            amount: numberOf(row.amount),
            currency: row.currency,
            includedInSummary: row.currency === currency,
            occurredAt: dateOnly(row.occurred_at),
            description: row.description,
            externalReference: row.external_reference,
            externalKey: row.external_key,
            identityMode: text(metadata.identityMode),
            wbsElement: text(metadata.wbsElement),
            accountingDocument: text(metadata.accountingDocument),
            companyCode: text(metadata.companyCode),
            fiscalYear: text(metadata.fiscalYear),
            accountingDocumentItem: text(metadata.accountingDocumentItem),
            costCode: row.cost_code,
            costCodeName: row.cost_code_name,
            materialCode: row.material_code,
            materialTitle: row.material_title,
          };
        });

        const prePoCommitments = prePoRows.map((row) => {
          const metadata = jsonObject(row.metadata);
          return {
            id: row.id,
            kind: 'PRE_PO' as const,
            amount: Math.max(0, numberOf(row.amount) - numberOf(row.released_amount)),
            currency: row.currency,
            includedInSummary: row.currency === currency,
            committedAt: dateOnly(row.committed_at),
            description: row.description,
            sourceReference: row.source_reference,
            externalKey: row.external_key,
            wbsElement: text(metadata.wbsElement),
            costCode: row.cost_code,
            costCodeName: row.cost_code_name,
          };
        });

        const purchaseOrderCommitments = purchaseOrderRows.map((row) => {
          const parsed = parsePoExternalKey(row.external_key);
          const outstandingQty = Math.max(0, numberOf(row.ordered_qty) - numberOf(row.received_qty));
          return {
            id: row.id,
            kind: 'PURCHASE_ORDER' as const,
            amount: outstandingQty * numberOf(row.unit_cost),
            currency: row.currency,
            includedInSummary: row.currency === currency,
            purchaseOrderId: row.purchase_order_id,
            purchaseOrderNumber: parsed.document ?? row.purchase_order_number,
            purchaseOrderPosition: parsed.position,
            orderedQty: numberOf(row.ordered_qty),
            receivedQty: numberOf(row.received_qty),
            outstandingQty,
            unitCost: numberOf(row.unit_cost),
            expectedDate: dateOnly(row.expected_date),
            supplierCode: row.supplier_code,
            supplierName: row.supplier_name,
            materialCode: row.material_code,
            materialTitle: row.material_title,
            externalKey: row.external_key,
          };
        });

        const actualAmount = actuals
          .filter((row) => row.includedInSummary)
          .reduce((sum, row) => sum + row.amount, 0);
        const prePoAmount = prePoCommitments
          .filter((row) => row.includedInSummary)
          .reduce((sum, row) => sum + row.amount, 0);
        const purchaseOrderAmount = purchaseOrderCommitments
          .filter((row) => row.includedInSummary)
          .reduce((sum, row) => sum + row.amount, 0);
        const sapOpenCommitment = prePoAmount + purchaseOrderAmount;
        const currencyIssueCount = [
          ...actuals,
          ...prePoCommitments,
          ...purchaseOrderCommitments,
        ].filter((row) => !row.includedInSummary).length;

        return {
          kind: 'ok' as const,
          payload: {
            version: 'v1g5',
            project: { id: project.id, title: project.title, workspaceId: project.workspaceId },
            currency,
            canonicalDatabase: 'BRIDATA_POSTGRESQL',
            excelRuntimeDependency: false,
            actualAuthority: dataPepAuthority ? 'SAP_DATA_PEP' : 'BRIDATA_MIXED',
            policies: {
              materialReceiptActualsSuppressed: dataPepAuthority,
              actualCostSource: dataPepAuthority ? 'SAP_DATA_PEP' : 'BRIDATA_MIXED',
              commitmentSource: 'OPEN_SAP_PRE_PO_PLUS_OUTSTANDING_SAP_PO',
              prePoClosedWhenPurchaseOrderAppears: true,
              goodsReceiptIsLogisticsNotAccountingActualWhenDataPepAuthorityActive: dataPepAuthority,
            },
            summary: {
              sapActualCost: Math.round(actualAmount * 10_000) / 10_000,
              sapPrePoCommitment: Math.round(prePoAmount * 10_000) / 10_000,
              sapPurchaseOrderCommitment: Math.round(purchaseOrderAmount * 10_000) / 10_000,
              sapOpenCommitment: Math.round(sapOpenCommitment * 10_000) / 10_000,
              sapSpentAndCommitted: Math.round((actualAmount + sapOpenCommitment) * 10_000) / 10_000,
              actualCount: actuals.length,
              prePoCommitmentCount: prePoCommitments.length,
              purchaseOrderLineCount: purchaseOrderCommitments.length,
              currencyIssueCount,
            },
            actuals,
            commitments: [...prePoCommitments, ...purchaseOrderCommitments],
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
