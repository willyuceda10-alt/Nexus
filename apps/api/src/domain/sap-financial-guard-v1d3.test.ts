import { describe, expect, it } from 'vitest';
import { buildSapFinancialGuardPlanV1d3, sapWbsExternalKeyV1d3 } from './sap-financial-guard-v1d3.js';

function record(
  id: string,
  sourceKey: string,
  externalKey: string | null,
  normalized: Record<string, unknown>,
) {
  return { id, sourceKey, externalKey, normalized };
}

const mapping = [{
  wbsElement: 'CSF-25-SAG-TR-I-RASN-012',
  projectId: '00000000-0000-4000-8000-000000000101',
  workspaceId: '00000000-0000-4000-8000-000000000003',
  workItemId: null,
}];

describe('SAP financial guard V1-D3', () => {
  it('keeps a PR-only obligation as the one pre-PO project commitment', () => {
    const plan = buildSapFinancialGuardPlanV1d3([
      record('c1', 'SAP_PROCUREMENT_COMMITMENTS', 'PR:1000001763:04420', {
        wbsElement: 'CSF-25-SAG-TR-I-RASN-012',
        companyCurrencyValue: 1250,
        reportCurrency: 'USD',
        materialDescription: 'Válvula',
      }),
    ], mapping);

    expect(plan.prePoCommitments).toHaveLength(1);
    expect(plan.prePoCommitments[0]?.externalKey).toBe('PR:1000001763:04420');
    expect(plan.poDerivedCommitments).toHaveLength(0);
    expect(plan.summary.actualRecordsDeferred).toBe(0);
  });

  it('does not duplicate a PO obligation into project_commitments', () => {
    const plan = buildSapFinancialGuardPlanV1d3([
      record('c1', 'SAP_PROCUREMENT_COMMITMENTS', 'PO:4500035208:00180', {
        wbsElement: 'CSF-25-SAG-TR-I-RASN-012',
        companyCurrencyValue: 1250,
        reportCurrency: 'USD',
      }),
    ], mapping);

    expect(plan.prePoCommitments).toHaveLength(0);
    expect(plan.poDerivedCommitments).toEqual([
      expect.objectContaining({
        poKey: 'PO:4500035208:00180',
        reason: 'PO_IS_CANONICAL_COMMITMENT_AUTHORITY',
      }),
    ]);
  });

  it('closes the PR representation when project procurement shows its successor PO', () => {
    const plan = buildSapFinancialGuardPlanV1d3([
      record('c1', 'SAP_PROCUREMENT_COMMITMENTS', 'PR:1000001763:04420', {
        wbsElement: 'CSF-25-SAG-TR-I-RASN-012',
        companyCurrencyValue: 1250,
        reportCurrency: 'USD',
      }),
      record('p1', 'SAP_PROJECT_PROCUREMENT', 'PR:1000001763:04420', {
        requisitionNumber: '1000001763',
        requisitionPosition: '04420',
        purchaseOrderNumber: '4500035208',
        purchaseOrderPosition: '00180',
      }),
    ], mapping);

    expect(plan.prePoCommitments).toHaveLength(0);
    expect(plan.poDerivedCommitments[0]).toMatchObject({
      poKey: 'PO:4500035208:00180',
      supersededPrKey: 'PR:1000001763:04420',
      reason: 'PR_SUPERSEDED_BY_PO',
    });
  });

  it('fails closed when WBS mapping or commitment line identity is missing', () => {
    const plan = buildSapFinancialGuardPlanV1d3([
      record('missing-map', 'SAP_PROCUREMENT_COMMITMENTS', 'PR:1:00010', {
        wbsElement: 'UNMAPPED-WBS', companyCurrencyValue: 100,
      }),
      record('legacy', 'SAP_PROCUREMENT_COMMITMENTS', null, {
        wbsElement: 'CSF-25-SAG-TR-I-RASN-012', companyCurrencyValue: 100,
      }),
    ], mapping);

    expect(plan.blockers.map((item) => item.code)).toEqual([
      'WBS_PROJECT_MAPPING_REQUIRED',
      'COMMITMENT_POSITION_IDENTITY_REQUIRED',
    ]);
  });

  it('defers DATA PEP actuals until V1-D4 instead of double counting goods receipts', () => {
    const plan = buildSapFinancialGuardPlanV1d3([
      record('a1', 'SAP_PROJECT_ACTUAL_COSTS', null, {
        wbsElement: 'CSF-25-SAG-TR-I-RASN-012',
        companyCurrencyValue: 400,
        materialCode: '13042034',
      }),
    ], mapping);

    expect(plan.deferredActualRecordIds).toEqual(['a1']);
    expect(plan.summary.actualRecordsDeferred).toBe(1);
    expect(plan.prePoCommitments).toHaveLength(0);
  });

  it('normalizes the WBS external mapping key deterministically', () => {
    expect(sapWbsExternalKeyV1d3(' csf-25-sag-tr-i-rasn-012 ')).toBe('WBS:CSF-25-SAG-TR-I-RASN-012');
  });
});
