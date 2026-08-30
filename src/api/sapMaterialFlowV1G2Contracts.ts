export type ApiSapMaterialFlowStateV1G2 =
  | 'AWAITING_ORDER'
  | 'ORDERED'
  | 'PARTIAL'
  | 'RECEIVED'
  | 'CONSUMED'
  | 'NO_ACTIVITY';

export type ApiSapMaterialFlowRiskV1G2 = 'NONE' | 'WATCH' | 'LATE' | 'UNMAPPED';

export interface ApiSapMaterialFlowRequisitionV1G2 {
  lineId: string;
  number: string;
  position: string | null;
  externalKey: string;
  quantity: number;
  status: string;
}

export interface ApiSapMaterialFlowPurchaseOrderV1G2 {
  lineId: string;
  number: string;
  position: string | null;
  externalKey: string;
  supplierName: string;
  quantity: number;
  receivedQty: number;
  outstandingQty: number;
  status: string;
  expectedDate: string | null;
}

export interface ApiSapMaterialFlowItemV1G2 {
  key: string;
  materialId: string;
  materialCode: string;
  materialTitle: string;
  uomCode: string;
  projectId: string | null;
  projectTitle: string | null;
  requestedQty: number;
  orderedQty: number;
  receivedQty: number;
  outstandingQty: number;
  consumedQty: number;
  stockQty: number;
  state: ApiSapMaterialFlowStateV1G2;
  risk: ApiSapMaterialFlowRiskV1G2;
  nextExpectedDate: string | null;
  lastSapActivityAt: string | null;
  requisitions: ApiSapMaterialFlowRequisitionV1G2[];
  purchaseOrders: ApiSapMaterialFlowPurchaseOrderV1G2[];
}

export interface ApiSapMaterialFlowV1G2 {
  version: 'v1g2';
  canonicalDatabase: 'BRIDATA_POSTGRESQL';
  excelRuntimeDependency: false;
  workspaceId: string;
  projectId: string | null;
  projectTitle: string | null;
  generatedAt: string;
  summary: {
    rowCount: number;
    materialCount: number;
    requestedQty: number;
    orderedQty: number;
    receivedQty: number;
    outstandingQty: number;
    consumedQty: number;
    stockQty: number;
    lateCount: number;
    attentionCount: number;
    unmappedCount: number;
  };
  materials: ApiSapMaterialFlowItemV1G2[];
  rules: {
    porLlegarDerived: 'PURCHASE_ORDER_QUANTITY_MINUS_RECEIVED_QTY';
    receivedDerivedFromInventoryLedger: true;
    consumedDerivedFromSap221Net222: true;
    stockDerivedFromCanonicalInventoryLedger: true;
    sapIdentityFromIntegrationEntityLinks: true;
  };
}
