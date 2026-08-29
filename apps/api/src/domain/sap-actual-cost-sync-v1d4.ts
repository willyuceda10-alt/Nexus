import { createHash } from 'node:crypto';
import { normalizeSapWbsElementV1d3 } from './sap-financial-guard-v1d3.js';

export type SapActualCostSourceRecordV1d4 = {
  id: string;
  externalKey: string | null;
  normalized: Record<string, unknown>;
};

export type SapActualCostWbsMappingV1d4 = {
  wbsElement: string;
  projectId: string;
  workspaceId: string;
  workItemId: string | null;
};

export type SapActualCostProjectionV1d4 = {
  externalKey: string;
  identityMode: 'EXACT_FI_LINE' | 'DOCUMENT_DIMENSION_AGGREGATE';
  sourceRecordIds: string[];
  wbsElement: string;
  projectId: string;
  workspaceId: string;
  workItemId: string | null;
  accountingDocument: string;
  companyCode: string | null;
  fiscalYear: string;
  accountingDocumentItem: string | null;
  postingDate: string;
  costElement: string | null;
  costElementName: string | null;
  materialCode: string | null;
  materialDescription: string | null;
  currency: string;
  amount: number;
  debitCreditIndicator: string | null;
  originalOperation: string | null;
  referenceDocument: string | null;
};

export type SapActualCostSyncPlanV1d4 = {
  projections: SapActualCostProjectionV1d4[];
  blockers: Array<{ recordId: string; code: string; details?: Record<string, unknown> }>;
  summary: {
    sourceRecords: number;
    exactFiLines: number;
    aggregateProjections: number;
    blocked: number;
    projects: number;
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

function numberValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value.trim().replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function signedAmount(value: unknown, indicator: unknown): number | null {
  const parsed = numberValue(value);
  if (parsed === null) return null;
  if (parsed < 0) return Math.round(parsed * 10_000) / 10_000;
  const direction = text(indicator)?.toUpperCase() ?? '';
  const credit = ['H', 'C', 'CREDIT', 'ABONO', 'HABER'].includes(direction);
  return Math.round((credit ? -Math.abs(parsed) : Math.abs(parsed)) * 10_000) / 10_000;
}

function normalizedFiItem(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  return /^\d+$/.test(raw) ? raw.padStart(3, '0') : raw;
}

function hashKey(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function identityFor(
  record: SapActualCostSourceRecordV1d4,
  wbsElement: string,
  accountingDocument: string,
  postingDate: string,
  currency: string,
): {
  externalKey: string;
  identityMode: SapActualCostProjectionV1d4['identityMode'];
  companyCode: string | null;
  fiscalYear: string;
  accountingDocumentItem: string | null;
} {
  const companyCode = text(record.normalized.companyCode)?.toUpperCase() ?? null;
  const fiscalYear = text(record.normalized.fiscalYear) ?? postingDate.slice(0, 4);
  const accountingDocumentItem = normalizedFiItem(record.normalized.accountingDocumentItem);
  if (companyCode && fiscalYear && accountingDocumentItem) {
    return {
      externalKey: `FI:${companyCode}:${fiscalYear}:${accountingDocument}:${accountingDocumentItem}`,
      identityMode: 'EXACT_FI_LINE',
      companyCode,
      fiscalYear,
      accountingDocumentItem,
    };
  }

  const aggregateIdentity = {
    wbsElement,
    companyCode,
    fiscalYear,
    accountingDocument,
    postingDate,
    costElement: text(record.normalized.costElement),
    materialCode: text(record.normalized.materialCode),
    currency,
    debitCreditIndicator: text(record.normalized.debitCreditIndicator)?.toUpperCase() ?? null,
    originalOperation: text(record.normalized.originalOperation)?.toUpperCase() ?? null,
    referenceDocument: text(record.normalized.referenceDocument),
  };
  return {
    externalKey: `FIAGG:${hashKey(aggregateIdentity)}`,
    identityMode: 'DOCUMENT_DIMENSION_AGGREGATE',
    companyCode,
    fiscalYear,
    accountingDocumentItem: null,
  };
}

export function buildSapActualCostSyncPlanV1d4(
  records: SapActualCostSourceRecordV1d4[],
  mappings: SapActualCostWbsMappingV1d4[],
): SapActualCostSyncPlanV1d4 {
  const mappingByWbs = new Map(
    mappings.map((mapping) => [normalizeSapWbsElementV1d3(mapping.wbsElement), mapping]),
  );
  const blockers: SapActualCostSyncPlanV1d4['blockers'] = [];
  const groups = new Map<string, SapActualCostProjectionV1d4>();

  for (const record of records) {
    const rawWbs = text(record.normalized.wbsElement);
    if (!rawWbs) {
      blockers.push({ recordId: record.id, code: 'WBS_ELEMENT_REQUIRED' });
      continue;
    }
    const wbsElement = normalizeSapWbsElementV1d3(rawWbs);
    const mapping = mappingByWbs.get(wbsElement);
    if (!mapping) {
      blockers.push({ recordId: record.id, code: 'WBS_PROJECT_MAPPING_REQUIRED', details: { wbsElement } });
      continue;
    }
    const accountingDocument = text(record.normalized.accountingDocument);
    if (!accountingDocument) {
      blockers.push({ recordId: record.id, code: 'ACCOUNTING_DOCUMENT_REQUIRED' });
      continue;
    }
    const postingDate = text(record.normalized.postingDate);
    if (!postingDate || !/^\d{4}-\d{2}-\d{2}$/.test(postingDate)) {
      blockers.push({ recordId: record.id, code: 'POSTING_DATE_REQUIRED' });
      continue;
    }
    const currency = text(record.normalized.companyCurrency)?.toUpperCase() ?? null;
    if (!currency || !/^[A-Z]{3}$/.test(currency)) {
      blockers.push({ recordId: record.id, code: 'COMPANY_CURRENCY_REQUIRED' });
      continue;
    }
    const amount = signedAmount(record.normalized.companyCurrencyValue, record.normalized.debitCreditIndicator);
    if (amount === null) {
      blockers.push({ recordId: record.id, code: 'ACTUAL_COST_AMOUNT_REQUIRED' });
      continue;
    }

    const identity = identityFor(record, wbsElement, accountingDocument, postingDate, currency);
    const groupingKey = `${mapping.projectId}|${identity.externalKey}`;
    const existing = groups.get(groupingKey);
    if (existing) {
      existing.amount = Math.round((existing.amount + amount) * 10_000) / 10_000;
      existing.sourceRecordIds.push(record.id);
      continue;
    }

    groups.set(groupingKey, {
      externalKey: identity.externalKey,
      identityMode: identity.identityMode,
      sourceRecordIds: [record.id],
      wbsElement,
      projectId: mapping.projectId,
      workspaceId: mapping.workspaceId,
      workItemId: mapping.workItemId,
      accountingDocument,
      companyCode: identity.companyCode,
      fiscalYear: identity.fiscalYear,
      accountingDocumentItem: identity.accountingDocumentItem,
      postingDate,
      costElement: text(record.normalized.costElement),
      costElementName: text(record.normalized.costElementName) ?? text(record.normalized.costClassDescription),
      materialCode: text(record.normalized.materialCode),
      materialDescription: text(record.normalized.materialDescription),
      currency,
      amount,
      debitCreditIndicator: text(record.normalized.debitCreditIndicator)?.toUpperCase() ?? null,
      originalOperation: text(record.normalized.originalOperation)?.toUpperCase() ?? null,
      referenceDocument: text(record.normalized.referenceDocument),
    });
  }

  const projections = [...groups.values()].sort((left, right) => left.externalKey.localeCompare(right.externalKey));
  return {
    projections,
    blockers,
    summary: {
      sourceRecords: records.length,
      exactFiLines: projections.filter((item) => item.identityMode === 'EXACT_FI_LINE').length,
      aggregateProjections: projections.filter((item) => item.identityMode === 'DOCUMENT_DIMENSION_AGGREGATE').length,
      blocked: blockers.length,
      projects: new Set(projections.map((item) => item.projectId)).size,
    },
  };
}
