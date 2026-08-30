import { buildSapProcurementProjectionV1G3 } from './sapProcurementV1G3';
import type { ApiSapMaterialFlowV1G2 } from '../api/sapMaterialFlowV1G2Contracts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const flow: ApiSapMaterialFlowV1G2 = {
  version: 'v1g2',
  canonicalDatabase: 'BRIDATA_POSTGRESQL',
  excelRuntimeDependency: false,
  workspaceId: 'ws',
  projectId: null,
  projectTitle: null,
  generatedAt: '2026-08-30T00:00:00.000Z',
  summary: {
    rowCount: 2,
    materialCount: 2,
    requestedQty: 15,
    orderedQty: 10,
    receivedQty: 6,
    outstandingQty: 4,
    consumedQty: 2,
    stockQty: 4,
    lateCount: 1,
    attentionCount: 1,
    unmappedCount: 0,
  },
  materials: [
    {
      key: 'p1:m1',
      materialId: 'm1',
      materialCode: '13000001',
      materialTitle: 'Válvula 2 pulgadas',
      uomCode: 'UND',
      projectId: 'p1',
      projectTitle: 'Proyecto Riego Norte',
      requestedQty: 10,
      orderedQty: 10,
      receivedQty: 6,
      outstandingQty: 4,
      consumedQty: 2,
      stockQty: 4,
      state: 'PARTIAL',
      risk: 'LATE',
      nextExpectedDate: '2026-08-29',
      lastSapActivityAt: '2026-08-30T00:00:00.000Z',
      requisitions: [{ lineId: 'prl1', number: '100000001', position: '10', externalKey: 'PR:100000001:10', quantity: 10, status: 'CONVERTED' }],
      purchaseOrders: [{ lineId: 'pol1', number: '450000001', position: '10', externalKey: 'PO:450000001:10', supplierName: 'Proveedor Uno', quantity: 10, receivedQty: 6, outstandingQty: 4, status: 'PARTIAL', expectedDate: '2026-08-29' }],
    },
    {
      key: 'p1:m2',
      materialId: 'm2',
      materialCode: '13000002',
      materialTitle: 'Tee PVC',
      uomCode: 'UND',
      projectId: 'p1',
      projectTitle: 'Proyecto Riego Norte',
      requestedQty: 5,
      orderedQty: 0,
      receivedQty: 0,
      outstandingQty: 0,
      consumedQty: 0,
      stockQty: 0,
      state: 'AWAITING_ORDER',
      risk: 'WATCH',
      nextExpectedDate: null,
      lastSapActivityAt: '2026-08-30T00:00:00.000Z',
      requisitions: [{ lineId: 'prl2', number: '100000002', position: '20', externalKey: 'PR:100000002:20', quantity: 5, status: 'APPROVED' }],
      purchaseOrders: [],
    },
  ],
  rules: {
    porLlegarDerived: 'PURCHASE_ORDER_QUANTITY_MINUS_RECEIVED_QTY',
    receivedDerivedFromInventoryLedger: true,
    consumedDerivedFromSap221Net222: true,
    stockDerivedFromCanonicalInventoryLedger: true,
    sapIdentityFromIntegrationEntityLinks: true,
  },
};

const result = buildSapProcurementProjectionV1G3(flow, '2026-08-30');
assert(result.summary.orderCount === 1, 'Expected one purchase order');
assert(result.summary.openOrderCount === 1, 'Expected one open purchase order');
assert(result.summary.partialOrderCount === 1, 'Expected partial purchase order');
assert(result.summary.lateOrderCount === 1, 'Expected late purchase order');
assert(result.summary.orderedQty === 10, 'Expected ordered quantity 10');
assert(result.summary.receivedQty === 6, 'Expected received quantity 6');
assert(result.summary.outstandingQty === 4, 'Expected outstanding quantity 4');
assert(result.orders[0]?.progressPct === 60, 'Expected 60% receipt progress');
assert(result.orders[0]?.risk === 'LATE', 'Expected late risk');
assert(result.summary.requisitionsWithoutOrderCount === 1, 'Expected one SolP without PO');
assert(result.requisitionsWithoutOrder[0]?.number === '100000002', 'Unexpected unconverted SolP');

console.log(JSON.stringify({
  sapProcurementV1G3: 'PASS',
  purchaseOrderGrouping: true,
  porLlegarDerived: true,
  lateRisk: true,
  unconvertedRequisitionsVisible: true,
  canonicalDatabase: flow.canonicalDatabase,
}));
