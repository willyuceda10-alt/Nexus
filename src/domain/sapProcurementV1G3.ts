import type { ApiSapMaterialFlowV1G2 } from '../api/sapMaterialFlowV1G2Contracts';

export type SapProcurementOrderStateV1G3 = 'ORDERED' | 'PARTIAL' | 'RECEIVED';
export type SapProcurementRiskV1G3 = 'NONE' | 'WATCH' | 'LATE';

export interface SapProcurementLineV1G3 {
  key: string;
  materialCode: string;
  materialTitle: string;
  uomCode: string;
  position: string | null;
  orderedQty: number;
  receivedQty: number;
  outstandingQty: number;
  expectedDate: string | null;
}

export interface SapProcurementOrderV1G3 {
  key: string;
  number: string;
  supplierName: string;
  projectId: string | null;
  projectTitle: string | null;
  state: SapProcurementOrderStateV1G3;
  risk: SapProcurementRiskV1G3;
  orderedQty: number;
  receivedQty: number;
  outstandingQty: number;
  progressPct: number;
  nextExpectedDate: string | null;
  lastSapActivityAt: string | null;
  lines: SapProcurementLineV1G3[];
}

export interface SapProcurementUnconvertedRequisitionV1G3 {
  key: string;
  number: string;
  position: string | null;
  materialCode: string;
  materialTitle: string;
  uomCode: string;
  quantity: number;
  projectId: string | null;
  projectTitle: string | null;
  lastSapActivityAt: string | null;
}

export interface SapProcurementProjectionV1G3 {
  orders: SapProcurementOrderV1G3[];
  requisitionsWithoutOrder: SapProcurementUnconvertedRequisitionV1G3[];
  summary: {
    orderCount: number;
    openOrderCount: number;
    partialOrderCount: number;
    receivedOrderCount: number;
    lateOrderCount: number;
    orderedQty: number;
    receivedQty: number;
    outstandingQty: number;
    requisitionsWithoutOrderCount: number;
  };
}

function numberOf(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function minDate(values: Array<string | null>): string | null {
  const dates = values.filter((value): value is string => Boolean(value)).sort();
  return dates[0] ?? null;
}

function maxTimestamp(values: Array<string | null>): string | null {
  const dates = values.filter((value): value is string => Boolean(value)).sort();
  return dates.at(-1) ?? null;
}

function riskOf(outstandingQty: number, expectedDate: string | null, todayIso: string): SapProcurementRiskV1G3 {
  if (outstandingQty <= 0) return 'NONE';
  if (!expectedDate) return 'WATCH';
  return expectedDate.slice(0, 10) < todayIso ? 'LATE' : 'NONE';
}

function stateOf(orderedQty: number, receivedQty: number): SapProcurementOrderStateV1G3 {
  if (orderedQty > 0 && receivedQty >= orderedQty) return 'RECEIVED';
  if (receivedQty > 0) return 'PARTIAL';
  return 'ORDERED';
}

export function buildSapProcurementProjectionV1G3(
  flow: ApiSapMaterialFlowV1G2,
  todayIso = new Date().toISOString().slice(0, 10),
): SapProcurementProjectionV1G3 {
  const orderMap = new Map<string, SapProcurementOrderV1G3>();
  const convertedPrKeys = new Set<string>();

  for (const material of flow.materials) {
    if (material.purchaseOrders.length > 0) {
      for (const requisition of material.requisitions) convertedPrKeys.add(requisition.externalKey);
    }

    for (const po of material.purchaseOrders) {
      const projectKey = material.projectId ?? 'UNMAPPED';
      const key = `${projectKey}:${po.number}`;
      const line: SapProcurementLineV1G3 = {
        key: `${key}:${po.lineId}`,
        materialCode: material.materialCode,
        materialTitle: material.materialTitle,
        uomCode: material.uomCode,
        position: po.position,
        orderedQty: numberOf(po.quantity),
        receivedQty: numberOf(po.receivedQty),
        outstandingQty: Math.max(0, numberOf(po.outstandingQty)),
        expectedDate: po.expectedDate,
      };

      const existing = orderMap.get(key);
      if (!existing) {
        const orderedQty = line.orderedQty;
        const receivedQty = line.receivedQty;
        const outstandingQty = line.outstandingQty;
        orderMap.set(key, {
          key,
          number: po.number,
          supplierName: po.supplierName || 'Proveedor sin nombre',
          projectId: material.projectId,
          projectTitle: material.projectTitle,
          state: stateOf(orderedQty, receivedQty),
          risk: riskOf(outstandingQty, po.expectedDate, todayIso),
          orderedQty,
          receivedQty,
          outstandingQty,
          progressPct: orderedQty > 0 ? Math.min(100, Math.round((receivedQty / orderedQty) * 100)) : 0,
          nextExpectedDate: po.expectedDate,
          lastSapActivityAt: material.lastSapActivityAt,
          lines: [line],
        });
        continue;
      }

      existing.lines.push(line);
      existing.orderedQty += line.orderedQty;
      existing.receivedQty += line.receivedQty;
      existing.outstandingQty += line.outstandingQty;
      existing.nextExpectedDate = minDate([existing.nextExpectedDate, line.expectedDate]);
      existing.lastSapActivityAt = maxTimestamp([existing.lastSapActivityAt, material.lastSapActivityAt]);
      existing.state = stateOf(existing.orderedQty, existing.receivedQty);
      existing.risk = riskOf(existing.outstandingQty, existing.nextExpectedDate, todayIso);
      existing.progressPct = existing.orderedQty > 0
        ? Math.min(100, Math.round((existing.receivedQty / existing.orderedQty) * 100))
        : 0;
    }
  }

  const requisitionsWithoutOrder: SapProcurementUnconvertedRequisitionV1G3[] = [];
  for (const material of flow.materials) {
    for (const pr of material.requisitions) {
      if (convertedPrKeys.has(pr.externalKey)) continue;
      requisitionsWithoutOrder.push({
        key: `${material.key}:${pr.lineId}`,
        number: pr.number,
        position: pr.position,
        materialCode: material.materialCode,
        materialTitle: material.materialTitle,
        uomCode: material.uomCode,
        quantity: numberOf(pr.quantity),
        projectId: material.projectId,
        projectTitle: material.projectTitle,
        lastSapActivityAt: material.lastSapActivityAt,
      });
    }
  }

  const orders = [...orderMap.values()]
    .map((order) => ({ ...order, lines: [...order.lines].sort((a, b) => (a.position ?? '').localeCompare(b.position ?? '')) }))
    .sort((a, b) => {
      const riskRank = { LATE: 0, WATCH: 1, NONE: 2 } as const;
      const riskDelta = riskRank[a.risk] - riskRank[b.risk];
      if (riskDelta !== 0) return riskDelta;
      return a.number.localeCompare(b.number);
    });

  return {
    orders,
    requisitionsWithoutOrder: requisitionsWithoutOrder.sort((a, b) => a.number.localeCompare(b.number)),
    summary: {
      orderCount: orders.length,
      openOrderCount: orders.filter((order) => order.state !== 'RECEIVED').length,
      partialOrderCount: orders.filter((order) => order.state === 'PARTIAL').length,
      receivedOrderCount: orders.filter((order) => order.state === 'RECEIVED').length,
      lateOrderCount: orders.filter((order) => order.risk === 'LATE').length,
      orderedQty: orders.reduce((sum, order) => sum + order.orderedQty, 0),
      receivedQty: orders.reduce((sum, order) => sum + order.receivedQty, 0),
      outstandingQty: orders.reduce((sum, order) => sum + order.outstandingQty, 0),
      requisitionsWithoutOrderCount: requisitionsWithoutOrder.length,
    },
  };
}
