export type SapFinancialAuthorityV1G5 = 'SAP_DATA_PEP' | 'BRIDATA_MIXED';

export interface SapFinancialActualV1G5 {
  id: string;
  amount: number;
  currency: string;
  includedInSummary: boolean;
  occurredAt: string | null;
  description: string;
  externalReference: string | null;
  externalKey: string;
  identityMode: string | null;
  wbsElement: string | null;
  accountingDocument: string | null;
  companyCode: string | null;
  fiscalYear: string | null;
  accountingDocumentItem: string | null;
  costCode: string | null;
  costCodeName: string | null;
  materialCode: string | null;
  materialTitle: string | null;
}

export interface SapFinancialPrePoCommitmentV1G5 {
  id: string;
  kind: 'PRE_PO';
  amount: number;
  currency: string;
  includedInSummary: boolean;
  committedAt: string | null;
  description: string;
  sourceReference: string | null;
  externalKey: string;
  wbsElement: string | null;
  costCode: string | null;
  costCodeName: string | null;
}

export interface SapFinancialPurchaseOrderCommitmentV1G5 {
  id: string;
  kind: 'PURCHASE_ORDER';
  amount: number;
  currency: string;
  includedInSummary: boolean;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  purchaseOrderPosition: string | null;
  orderedQty: number;
  receivedQty: number;
  outstandingQty: number;
  unitCost: number;
  expectedDate: string | null;
  supplierCode: string | null;
  supplierName: string | null;
  materialCode: string;
  materialTitle: string;
  externalKey: string;
}

export type SapFinancialCommitmentV1G5 =
  | SapFinancialPrePoCommitmentV1G5
  | SapFinancialPurchaseOrderCommitmentV1G5;

export interface SapFinancialViewV1G5 {
  version: 'v1g5';
  project: { id: string; title: string; workspaceId: string };
  currency: string;
  canonicalDatabase: 'BRIDATA_POSTGRESQL';
  excelRuntimeDependency: false;
  actualAuthority: SapFinancialAuthorityV1G5;
  policies: {
    materialReceiptActualsSuppressed: boolean;
    actualCostSource: SapFinancialAuthorityV1G5;
    commitmentSource: 'OPEN_SAP_PRE_PO_PLUS_OUTSTANDING_SAP_PO';
    prePoClosedWhenPurchaseOrderAppears: true;
    goodsReceiptIsLogisticsNotAccountingActualWhenDataPepAuthorityActive: boolean;
  };
  summary: {
    sapActualCost: number;
    sapPrePoCommitment: number;
    sapPurchaseOrderCommitment: number;
    sapOpenCommitment: number;
    sapSpentAndCommitted: number;
    actualCount: number;
    prePoCommitmentCount: number;
    purchaseOrderLineCount: number;
    currencyIssueCount: number;
  };
  actuals: SapFinancialActualV1G5[];
  commitments: SapFinancialCommitmentV1G5[];
  calculatedAt: string;
}
