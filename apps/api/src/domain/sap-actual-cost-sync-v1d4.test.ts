import { describe, expect, it } from 'vitest';
import { buildSapActualCostSyncPlanV1d4 } from './sap-actual-cost-sync-v1d4.js';

const mapping = [{
  wbsElement: 'CSF-25-SAG-TR-I-RASN-012',
  projectId: '00000000-0000-4000-8000-000000000101',
  workspaceId: '00000000-0000-4000-8000-000000000003',
  workItemId: null,
}];

function row(id: string, normalized: Record<string, unknown>) {
  return { id, externalKey: null, normalized };
}

describe('SAP actual cost sync V1-D4', () => {
  it('uses exact FI identity when company, year, document and item exist', () => {
    const plan = buildSapActualCostSyncPlanV1d4([
      row('a1', {
        wbsElement: 'CSF-25-SAG-TR-I-RASN-012',
        companyCode: '1000', fiscalYear: '2026', accountingDocument: '5000001234', accountingDocumentItem: 1,
        postingDate: '2026-08-29', companyCurrency: 'USD', companyCurrencyValue: 125,
      }),
    ], mapping);
    expect(plan.projections).toHaveLength(1);
    expect(plan.projections[0]?.externalKey).toBe('FI:1000:2026:5000001234:001');
    expect(plan.projections[0]?.identityMode).toBe('EXACT_FI_LINE');
  });

  it('aggregates legacy DATA PEP rows deterministically instead of inventing a line item', () => {
    const normalized = {
      wbsElement: 'CSF-25-SAG-TR-I-RASN-012', accountingDocument: '5000001234', postingDate: '2026-08-29',
      companyCurrency: 'USD', companyCurrencyValue: 50, costElement: '610100', materialCode: '13042034',
      originalOperation: 'RMWE', referenceDocument: '5000999999',
    };
    const plan = buildSapActualCostSyncPlanV1d4([row('a1', normalized), row('a2', normalized)], mapping);
    expect(plan.projections).toHaveLength(1);
    expect(plan.projections[0]?.identityMode).toBe('DOCUMENT_DIMENSION_AGGREGATE');
    expect(plan.projections[0]?.externalKey.startsWith('FIAGG:')).toBe(true);
    expect(plan.projections[0]?.amount).toBe(100);
    expect(plan.projections[0]?.sourceRecordIds).toEqual(['a1', 'a2']);
  });

  it('preserves SAP credits as signed negative actual cost', () => {
    const plan = buildSapActualCostSyncPlanV1d4([
      row('credit', {
        wbsElement: 'CSF-25-SAG-TR-I-RASN-012', accountingDocument: '5000001235', postingDate: '2026-08-29',
        companyCurrency: 'USD', companyCurrencyValue: 25, debitCreditIndicator: 'H', costElement: '610100',
      }),
    ], mapping);
    expect(plan.projections[0]?.amount).toBe(-25);
  });

  it('keeps already-signed negative SAP values negative without double inversion', () => {
    const plan = buildSapActualCostSyncPlanV1d4([
      row('credit', {
        wbsElement: 'CSF-25-SAG-TR-I-RASN-012', accountingDocument: '5000001236', postingDate: '2026-08-29',
        companyCurrency: 'USD', companyCurrencyValue: -25, debitCreditIndicator: 'H',
      }),
    ], mapping);
    expect(plan.projections[0]?.amount).toBe(-25);
  });

  it('fails closed when WBS mapping, accounting document, date or currency is missing', () => {
    const plan = buildSapActualCostSyncPlanV1d4([
      row('map', { wbsElement: 'UNMAPPED', accountingDocument: '1', postingDate: '2026-08-29', companyCurrency: 'USD', companyCurrencyValue: 1 }),
      row('doc', { wbsElement: 'CSF-25-SAG-TR-I-RASN-012', postingDate: '2026-08-29', companyCurrency: 'USD', companyCurrencyValue: 1 }),
      row('date', { wbsElement: 'CSF-25-SAG-TR-I-RASN-012', accountingDocument: '2', companyCurrency: 'USD', companyCurrencyValue: 1 }),
      row('currency', { wbsElement: 'CSF-25-SAG-TR-I-RASN-012', accountingDocument: '3', postingDate: '2026-08-29', companyCurrencyValue: 1 }),
    ], mapping);
    expect(plan.blockers.map((item) => item.code)).toEqual([
      'WBS_PROJECT_MAPPING_REQUIRED',
      'ACCOUNTING_DOCUMENT_REQUIRED',
      'POSTING_DATE_REQUIRED',
      'COMPANY_CURRENCY_REQUIRED',
    ]);
  });
});
