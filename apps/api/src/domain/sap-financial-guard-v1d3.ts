export type SapFinancialSourceRecordV1d3 = {
  id: string;
  sourceKey: string;
  externalKey: string | null;
  normalized: Record<string, unknown>;
};

export type SapWbsProjectMappingV1d3 = {
  wbsElement: string;
  projectId: string;
  workspaceId: string;
  workItemId: string | null;
};

export type SapPrePoCommitmentCandidateV1d3 = {
  recordId: string;
  externalKey: string;
  wbsElement: string;
  projectId: string;
  workspaceId: string;
  workItemId: string | null;
  amount: number;
  currency: string | null;
  description: string;
  costElement: string | null;
  postingDate: string | null;
};

export type SapPoDerivedCommitmentV1d3 = {
  recordId: string;
  poKey: string;
  wbsElement: string;
  projectId: string;
  workspaceId: string;
  workItemId: string | null;
  reason: 'PO_IS_CANONICAL_COMMITMENT_AUTHORITY' | 'PR_SUPERSEDED_BY_PO';
  supersededPrKey: string | null;
};

export type SapFinancialGuardPlanV1d3 = {
  prePoCommitments: SapPrePoCommitmentCandidateV1d3[];
  poDerivedCommitments: SapPoDerivedCommitmentV1d3[];
  deferredActualRecordIds: string[];
  blockers: Array<{ recordId: string; code: string; details?: Record<string, unknown> }>;
  summary: {
    commitmentRecords: number;
    prePoCommitments: number;
    poDerivedCommitments: number;
    supersededPrePoCommitments: number;
    actualRecordsDeferred: number;
    blocked: number;
  };
};

function text(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value).replace(/\.0+$/, '');
  return null;
}

function amount(value: unknown): number | null {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value.trim().replace(',', '.'))
      : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 10_000) / 10_000 : null;
}

function position(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  return /^\d+$/.test(raw) ? raw.padStart(5, '0') : raw;
}

export function normalizeSapWbsElementV1d3(value: string): string {
  return value.trim().toUpperCase();
}

export function sapWbsExternalKeyV1d3(value: string): string {
  return `WBS:${normalizeSapWbsElementV1d3(value)}`;
}

function prKey(record: SapFinancialSourceRecordV1d3): string | null {
  if (record.sourceKey !== 'SAP_PROJECT_PROCUREMENT') return null;
  const number = text(record.normalized.requisitionNumber);
  const item = position(record.normalized.requisitionPosition);
  return number && item ? `PR:${number}:${item}` : null;
}

function poKey(record: SapFinancialSourceRecordV1d3): string | null {
  if (record.sourceKey !== 'SAP_PROJECT_PROCUREMENT') return null;
  const number = text(record.normalized.purchaseOrderNumber);
  const item = position(record.normalized.purchaseOrderPosition);
  return number && item ? `PO:${number}:${item}` : null;
}

function description(record: SapFinancialSourceRecordV1d3): string {
  return (
    text(record.normalized.materialDescription)
    ?? text(record.normalized.costElementName)
    ?? text(record.normalized.costClassDescription)
    ?? `Compromiso SAP ${record.externalKey ?? record.id}`
  ).slice(0, 500);
}

export function buildSapFinancialGuardPlanV1d3(
  records: SapFinancialSourceRecordV1d3[],
  mappings: SapWbsProjectMappingV1d3[],
): SapFinancialGuardPlanV1d3 {
  const commitmentRecords = records.filter((record) => record.sourceKey === 'SAP_PROCUREMENT_COMMITMENTS');
  const actualRecords = records.filter((record) => record.sourceKey === 'SAP_PROJECT_ACTUAL_COSTS');
  const procurementRecords = records.filter((record) => record.sourceKey === 'SAP_PROJECT_PROCUREMENT');

  const mappingByWbs = new Map(
    mappings.map((mapping) => [normalizeSapWbsElementV1d3(mapping.wbsElement), mapping]),
  );
  const poByPr = new Map<string, Set<string>>();
  for (const record of procurementRecords) {
    const pr = prKey(record);
    const po = poKey(record);
    if (!pr || !po) continue;
    const current = poByPr.get(pr) ?? new Set<string>();
    current.add(po);
    poByPr.set(pr, current);
  }

  const prePoCommitments: SapPrePoCommitmentCandidateV1d3[] = [];
  const poDerivedCommitments: SapPoDerivedCommitmentV1d3[] = [];
  const blockers: SapFinancialGuardPlanV1d3['blockers'] = [];

  for (const record of commitmentRecords) {
    const wbsElementRaw = text(record.normalized.wbsElement);
    if (!wbsElementRaw) {
      blockers.push({ recordId: record.id, code: 'WBS_ELEMENT_REQUIRED' });
      continue;
    }
    const wbsElement = normalizeSapWbsElementV1d3(wbsElementRaw);
    const mapping = mappingByWbs.get(wbsElement);
    if (!mapping) {
      blockers.push({ recordId: record.id, code: 'WBS_PROJECT_MAPPING_REQUIRED', details: { wbsElement } });
      continue;
    }
    if (!record.externalKey) {
      blockers.push({ recordId: record.id, code: 'COMMITMENT_POSITION_IDENTITY_REQUIRED' });
      continue;
    }

    if (record.externalKey.startsWith('PO:')) {
      poDerivedCommitments.push({
        recordId: record.id,
        poKey: record.externalKey,
        wbsElement,
        projectId: mapping.projectId,
        workspaceId: mapping.workspaceId,
        workItemId: mapping.workItemId,
        reason: 'PO_IS_CANONICAL_COMMITMENT_AUTHORITY',
        supersededPrKey: null,
      });
      continue;
    }

    if (!record.externalKey.startsWith('PR:')) {
      blockers.push({ recordId: record.id, code: 'UNSUPPORTED_COMMITMENT_REFERENCE_TYPE', details: { externalKey: record.externalKey } });
      continue;
    }

    const successorPoKeys = [...(poByPr.get(record.externalKey) ?? new Set<string>())];
    if (successorPoKeys.length > 1) {
      blockers.push({
        recordId: record.id,
        code: 'MULTIPLE_PURCHASE_ORDERS_FOR_REQUISITION_LINE',
        details: { externalKey: record.externalKey, successorPoKeys },
      });
      continue;
    }
    if (successorPoKeys.length === 1) {
      poDerivedCommitments.push({
        recordId: record.id,
        poKey: successorPoKeys[0]!,
        wbsElement,
        projectId: mapping.projectId,
        workspaceId: mapping.workspaceId,
        workItemId: mapping.workItemId,
        reason: 'PR_SUPERSEDED_BY_PO',
        supersededPrKey: record.externalKey,
      });
      continue;
    }

    const commitmentAmount = amount(record.normalized.companyCurrencyValue);
    if (commitmentAmount === null) {
      blockers.push({ recordId: record.id, code: 'POSITIVE_COMMITMENT_AMOUNT_REQUIRED' });
      continue;
    }
    const deletionIndicator = text(record.normalized.deletionIndicator);
    if (deletionIndicator && deletionIndicator !== '0') {
      blockers.push({ recordId: record.id, code: 'DELETED_COMMITMENT_NOT_OPEN', details: { deletionIndicator } });
      continue;
    }

    prePoCommitments.push({
      recordId: record.id,
      externalKey: record.externalKey,
      wbsElement,
      projectId: mapping.projectId,
      workspaceId: mapping.workspaceId,
      workItemId: mapping.workItemId,
      amount: commitmentAmount,
      currency: text(record.normalized.reportCurrency)?.toUpperCase() ?? null,
      description: description(record),
      costElement: text(record.normalized.costElement),
      postingDate: text(record.normalized.postingDate) ?? text(record.normalized.documentDate),
    });
  }

  return {
    prePoCommitments,
    poDerivedCommitments,
    deferredActualRecordIds: actualRecords.map((record) => record.id),
    blockers,
    summary: {
      commitmentRecords: commitmentRecords.length,
      prePoCommitments: prePoCommitments.length,
      poDerivedCommitments: poDerivedCommitments.length,
      supersededPrePoCommitments: poDerivedCommitments.filter((item) => item.supersededPrKey !== null).length,
      actualRecordsDeferred: actualRecords.length,
      blocked: blockers.length,
    },
  };
}
