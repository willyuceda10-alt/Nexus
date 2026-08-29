import { describe, expect, it } from 'vitest';
import { buildSapInventorySyncPlanV1d2, canonicalWarehouseCodeV1d2 } from './sap-inventory-sync-v1d2.js';

function record(id: string, externalKey: string | null, normalized: Record<string, unknown>) {
  return { id, sourceKey: 'SAP_MATERIAL_MOVEMENTS', externalKey, normalized };
}

describe('SAP inventory sync V1-D2', () => {
  it('accepts an exact MATDOC receipt identity', () => {
    const plan = buildSapInventorySyncPlanV1d2([
      record('r1', 'MATDOC:2026:5001234567:00001', {
        materialDocumentNumber: '5001234567',
        materialDocumentYear: '2026',
        materialDocumentItem: '00001',
        materialCode: '13042034',
        plant: '1000',
        warehouse: '0001',
        quantity: 8,
        sapMovementType: '101',
        movementSemantics: 'RECEIPT',
        purchaseOrderNumber: '4500035208',
        purchaseOrderPosition: '00180',
      }),
    ]);

    expect(plan.summary.exactIdentityCandidates).toBe(1);
    expect(plan.summary.receipts).toBe(1);
    expect(plan.blockers).toHaveLength(0);
    expect(plan.candidates[0]?.canonicalMovementType).toBe('RECEIPT');
    expect(plan.candidates[0]?.purchaseOrderExternalKey).toBe('PO:4500035208:00180');
  });

  it('blocks movement rows that do not expose exact material-document item identity', () => {
    const plan = buildSapInventorySyncPlanV1d2([
      record('legacy', null, {
        materialCode: '13042034', plant: '1000', warehouse: '0001', quantity: 5,
        sapMovementType: '101', movementSemantics: 'RECEIPT',
      }),
    ]);
    expect(plan.candidates).toHaveLength(0);
    expect(plan.blockers).toEqual([{ recordId: 'legacy', code: 'MATERIAL_DOCUMENT_ITEM_IDENTITY_REQUIRED' }]);
  });

  it('maps SAP reversal and issue semantics without creating financial events', () => {
    const rows = [
      ['102', 'RECEIPT_REVERSAL', 'ADJUSTMENT_OUT'],
      ['221', 'ISSUE', 'ISSUE'],
      ['222', 'ISSUE_REVERSAL', 'ADJUSTMENT_IN'],
    ] as const;
    for (const [sapMovementType, semantics, expected] of rows) {
      const plan = buildSapInventorySyncPlanV1d2([
        record(sapMovementType, `MATDOC:2026:500${sapMovementType}:00001`, {
          materialDocumentNumber: `500${sapMovementType}`,
          materialDocumentYear: '2026',
          materialDocumentItem: '00001',
          materialCode: '13042034', plant: '1000', warehouse: '0001', quantity: -2,
          sapMovementType, movementSemantics: semantics,
        }),
      ]);
      expect(plan.candidates[0]?.canonicalMovementType).toBe(expected);
      expect(plan.candidates[0]?.quantity).toBe(2);
    }
  });

  it('blocks transfer/ambiguous movement semantics until target identity is available', () => {
    const plan = buildSapInventorySyncPlanV1d2([
      record('311', 'MATDOC:2026:500311:00001', {
        materialDocumentNumber: '500311', materialDocumentYear: '2026', materialDocumentItem: '00001',
        materialCode: '13042034', plant: '1000', warehouse: '0001', quantity: 3,
        sapMovementType: '311', movementSemantics: 'TRANSFER',
      }),
    ]);
    expect(plan.candidates).toHaveLength(0);
    expect(plan.blockers[0]?.code).toBe('MOVEMENT_SEMANTICS_NOT_SAFE_FOR_CANONICAL_SYNC');
  });

  it('builds warehouse identity from plant + storage location', () => {
    expect(canonicalWarehouseCodeV1d2('1000', '0001')).toBe('1000:0001');
  });
});
