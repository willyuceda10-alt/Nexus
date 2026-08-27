export type ApiCostHealthV2 = 'NO_BUDGET' | 'ON_TRACK' | 'WATCH' | 'HIGH' | 'CRITICAL';

export interface ApiCostCodeV2 {
  id: string;
  code: string;
  name: string;
  category: 'MATERIAL' | 'LABOR' | 'EQUIPMENT' | 'SERVICE' | 'SUBCONTRACT' | 'OTHER';
  parent_cost_code_id: string | null;
}

export interface ApiCostCatalogV2 {
  costCodes: ApiCostCodeV2[];
  suppliers: Array<{ id: string; code: string; name: string }>;
}

export interface ApiCostSummaryV2 {
  plannedBudget: number;
  approvedBudget: number;
  contingencyAmount: number;
  controlBudget: number;
  actualCost: number;
  manualActual: number;
  materialActual: number;
  openCommitment: number;
  manualOpenCommitment: number;
  materialOpenCommitment: number;
  forecastRemainingUncommitted: number;
  estimateToComplete: number;
  estimateAtCompletion: number;
  varianceAtCompletion: number;
  forecastVariancePercent: number | null;
  spentAndCommitted: number;
  remainingAfterActualAndCommitment: number;
  health: ApiCostHealthV2;
}

export interface ApiCostBudgetLineV2 {
  id: string;
  workItemId: string | null;
  workItemTitle: string | null;
  costCodeId: string;
  costCode: string;
  costCodeName: string;
  materialId: string | null;
  materialName: string | null;
  description: string;
  plannedAmount: number;
  approvedAmount: number;
  actualAmount: number;
  commitmentAmount: number;
  forecastRemainingUncommitted: number;
  estimateAtCompletion: number;
  varianceAtCompletion: number;
  forecastIsExplicit: boolean;
}

export interface ApiProjectCostOverviewV2 {
  project: { id: string; title: string; workspaceId: string };
  profile: { id: string; currency: string; contingencyAmount: number } | null;
  currency: string;
  summary: ApiCostSummaryV2;
  lines: ApiCostBudgetLineV2[];
  unallocated: { actual: number; commitment: number };
  workItems: Array<{
    workItemId: string;
    budget: number;
    actual: number;
    commitment: number;
    eac: number;
    varianceAtCompletion: number;
    atRisk: boolean;
  }>;
  baseline: {
    id: string;
    version: number;
    capturedAt: string;
    approvedBudget: number;
    plannedBudget: number;
    contingencyAmount: number;
    approvedVariance: number;
  } | null;
  currencyIssues: Array<{ source: string; id: string; currency: string | null }>;
  counts: {
    budgetLines: number;
    manualActuals: number;
    materialReceipts: number;
    manualCommitments: number;
    materialCommitments: number;
  };
  calculatedAt: string;
}

export interface CreateApiCostCodeV2Input {
  workspaceId: string;
  code: string;
  name: string;
  category?: ApiCostCodeV2['category'];
  parentCostCodeId?: string | null;
}

export interface UpdateApiCostProfileV2Input {
  currency: string;
  contingencyAmount: number;
}

export interface CreateApiBudgetLineV2Input {
  costCodeId: string;
  workItemId?: string | null;
  materialId?: string | null;
  description: string;
  plannedAmount: number;
  approvedAmount: number;
  forecastRemainingUncommitted?: number | null;
  notes?: string | null;
}

export interface UpdateApiBudgetLineV2Input {
  workItemId?: string | null;
  materialId?: string | null;
  description?: string;
  plannedAmount?: number;
  approvedAmount?: number;
  forecastRemainingUncommitted?: number | null;
  notes?: string | null;
}

export interface CreateApiCommitmentV2Input {
  workItemId?: string | null;
  costCodeId?: string | null;
  supplierId?: string | null;
  description: string;
  amount: number;
  currency: string;
  sourceType?: 'MANUAL' | 'CONTRACT' | 'SAP_IMPORT' | 'OTHER';
  sourceReference?: string | null;
  committedAt?: string;
  notes?: string | null;
}

export interface CreateApiActualCostV2Input {
  workItemId?: string | null;
  costCodeId?: string | null;
  materialId?: string | null;
  description: string;
  amount: number;
  currency: string;
  sourceType?: 'MANUAL' | 'SAP_IMPORT' | 'ACCRUAL' | 'OTHER';
  externalReference?: string | null;
  occurredAt?: string;
  notes?: string | null;
}

export interface ApiCostBackfillV2Response {
  projectId: string;
  dryRun: boolean;
  createProfile: boolean;
  createBudgetLine: boolean;
  createLegacyActual: boolean;
  legacyBudget: number;
  legacySpent: number;
  currency: string;
}