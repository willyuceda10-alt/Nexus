import { describe, expect, it } from 'vitest';
import {
  buildSapReconciliationPlanV1c,
  type SapReconciliationRecordV1c,
} from './sap-reconciliation-v1c.js';

function record(
  id: string,
  sourceKey: string,
  normalized: Record<string, unknown>,
  externalKey: string | null = null,
  profileId = 'test',
): SapReconciliationRecordV1c {
  return { id, batchId: `batch-${id}`, sourceKey, profileId, externalKey, normalized };
}

describe('SAP reconciliation V1-C', () => {
  it('links PR -> PO using both document positions exactly', () => {
    const plan = buildSapReconciliationPlanV1c([
      record('project', 'SAP_PROJECT_PROCUREMENT', {
        requisitionNumber: '1000001763', requisitionPosition: '04420',
        purchaseOrderNumber: '4500035208', purchaseOrderPosition: '00180',
      }, 'PR:1000001763:04420'),
      record('open', 'SAP_OPEN_PURCHASE_ORDERS', {
        requisitionNumber: '1000001763', requisitionPosition: '04420',
        purchaseOrderNumber: '4500035208', purchaseOrderPosition: '00180',
      }, 'PO:4500035208:00180'),
    ]);

    expect(plan.summary.exactMatches).toBe(1);
    expect(plan.candidates[0]).toMatchObject({
      relationshipType: 'REQUISITION_LINE_TO_PURCHASE_ORDER_LINE',
      matchMethod: 'REQUEST_AND_DOCUMENT_POSITION',
      confidence: 1,
      status: 'MATCHED',
    });
  });

  it('links enriched PR and PO commitments by exact external identity', () => {
    const plan = buildSapReconciliationPlanV1c([
      record('project', 'SAP_PROJECT_PROCUREMENT', {
        requisitionNumber: '1000001763', requisitionPosition: '04420',
        purchaseOrderNumber: '4500035208', purchaseOrderPosition: '00180',
      }, 'PR:1000001763:04420'),
      record('open', 'SAP_OPEN_PURCHASE_ORDERS', {
        requisitionNumber: '1000001763', requisitionPosition: '04420',
        purchaseOrderNumber: '4500035208', purchaseOrderPosition: '00180',
      }, 'PO:4500035208:00180'),
      record('commit-pr', 'SAP_PROCUREMENT_COMMITMENTS', {}, 'PR:1000001763:04420', 'commitments_enriched_v1'),
      record('commit-po', 'SAP_PROCUREMENT_COMMITMENTS', {}, 'PO:4500035208:00180', 'commitments_enriched_v1'),
    ]);

    const links = plan.candidates.filter((candidate) => candidate.relationshipType === 'COMMITMENT_REFERENCE_TO_PROCUREMENT_LINE');
    expect(links).toHaveLength(2);
    expect(links.every((link) => link.status === 'MATCHED' && link.confidence === 1)).toBe(true);
  });

  it('links 101/102 receipts through PO + position but does not force issues through PO', () => {
    const plan = buildSapReconciliationPlanV1c([
      record('open', 'SAP_OPEN_PURCHASE_ORDERS', {
        purchaseOrderNumber: '4500035208', purchaseOrderPosition: '00180',
      }, 'PO:4500035208:00180'),
      record('receipt', 'SAP_MATERIAL_MOVEMENTS', {
        purchaseOrderNumber: '4500035208', purchaseOrderPosition: '00180',
        sapMovementType: '101', movementSemantics: 'RECEIPT', quantity: 197,
      }),
      record('issue', 'SAP_MATERIAL_MOVEMENTS', {
        purchaseOrderNumber: '4500035208', purchaseOrderPosition: '00180',
        reservationNumber: '1609505', reservationPosition: '00001',
        sapMovementType: '221', movementSemantics: 'ISSUE', quantity: -26,
      }),
    ]);

    const receiptLinks = plan.candidates.filter((candidate) => candidate.relationshipType === 'PURCHASE_ORDER_LINE_TO_MATERIAL_RECEIPT');
    expect(receiptLinks).toHaveLength(1);
    expect(receiptLinks[0]?.rightRecordId).toBe('receipt');
  });

  it('keeps movement -> actual cost as a proposal when only fallback fields are available', () => {
    const plan = buildSapReconciliationPlanV1c([
      record('movement', 'SAP_MATERIAL_MOVEMENTS', {
        wbsElement: 'CSF-25-SAG-TR-I-RASN-012', materialCode: '13003098',
        postingDate: '2026-08-20', quantity: -26,
        sapMovementType: '221', movementSemantics: 'ISSUE',
      }),
      record('actual', 'SAP_PROJECT_ACTUAL_COSTS', {
        wbsElement: 'CSF-25-SAG-TR-I-RASN-012', materialCode: '13003098',
        postingDate: '2026-08-20', quantity: 26,
        accountingDocument: '4910568615', originalOperation: 'RMWA',
      }),
    ]);

    const link = plan.candidates.find((candidate) => candidate.relationshipType === 'MATERIAL_MOVEMENT_TO_ACTUAL_COST');
    expect(link).toMatchObject({
      status: 'PROPOSED',
      matchMethod: 'HEURISTIC_WBS_MATERIAL_DATE_QUANTITY',
      confidence: 0.95,
    });
    expect(link?.evidence.deterministic).toBe(false);
  });

  it('marks multiple financial candidates ambiguous instead of inventing an exact join', () => {
    const movement = record('movement', 'SAP_MATERIAL_MOVEMENTS', {
      wbsElement: 'PEP-1', materialCode: '13003098', postingDate: '2026-08-20', quantity: -26,
      sapMovementType: '221', movementSemantics: 'ISSUE',
    });
    const actualA = record('actual-a', 'SAP_PROJECT_ACTUAL_COSTS', {
      wbsElement: 'PEP-1', materialCode: '13003098', postingDate: '2026-08-20', quantity: 26,
      accountingDocument: '4900000001', originalOperation: 'RMWA',
    });
    const actualB = record('actual-b', 'SAP_PROJECT_ACTUAL_COSTS', {
      wbsElement: 'PEP-1', materialCode: '13003098', postingDate: '2026-08-20', quantity: 26,
      accountingDocument: '4900000002', originalOperation: 'RMWA',
    });

    const plan = buildSapReconciliationPlanV1c([movement, actualA, actualB]);
    const candidates = plan.candidates.filter((candidate) => candidate.relationshipType === 'MATERIAL_MOVEMENT_TO_ACTUAL_COST');
    expect(candidates).toHaveLength(2);
    expect(candidates.every((candidate) => candidate.status === 'AMBIGUOUS' && candidate.confidence === 0.7)).toBe(true);
  });

  it('does not auto-match legacy commitments without position identity', () => {
    const plan = buildSapReconciliationPlanV1c([
      record('legacy', 'SAP_PROCUREMENT_COMMITMENTS', { referenceDocument: '1000001763' }, null, 'commitments_legacy_v1'),
      record('project', 'SAP_PROJECT_PROCUREMENT', {
        requisitionNumber: '1000001763', requisitionPosition: '04420',
      }, 'PR:1000001763:04420'),
    ]);

    expect(plan.candidates).toHaveLength(0);
  });
});
