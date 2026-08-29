import { describe, expect, it } from 'vitest';
import { buildCanonicalSyncPlanV1d1, derivePurchaseOrderStatusV1d1 } from './sap-canonical-sync-v1d1.js';

function record(id: string, sourceKey: string, externalKey: string | null, normalized: Record<string, unknown>) {
  return { id, sourceKey, externalKey, normalized };
}

describe('SAP canonical sync V1-D1', () => {
  it('plans requisition and purchase-order rows without writing movements', () => {
    const plan = buildCanonicalSyncPlanV1d1([
      record('pr1', 'SAP_PROJECT_PROCUREMENT', 'PR:1000001763:04420', {
        requisitionNumber: '1000001763',
        requisitionPosition: '04420',
        materialCode: '13042034',
        description: 'Valvula',
        uom: 'UND',
      }),
      record('po1', 'SAP_OPEN_PURCHASE_ORDERS', 'PO:4500035208:00180', {
        purchaseOrderNumber: '4500035208',
        purchaseOrderPosition: '00180',
        materialCode: '13042034',
        description: 'Valvula',
        orderUom: 'UND',
        supplierOrSupplyingPlant: '0000123456 PROVEEDOR SAC',
      }),
      record('mv1', 'SAP_MATERIAL_MOVEMENTS', null, {
        sapMovementType: '101',
        purchaseOrderNumber: '4500035208',
        purchaseOrderPosition: '00180',
      }),
    ]);

    expect(plan.summary).toEqual({
      requisitionLines: 1,
      purchaseOrderLines: 1,
      uniqueMaterials: 1,
      uniqueSuppliers: 1,
      blockedMovements: 1,
    });
    expect(plan.blockedMovements[0]?.reason).toBe('MATERIAL_DOCUMENT_ITEM_IDENTITY_REQUIRED');
  });

  it('ignores service rows without material code from physical material master planning', () => {
    const plan = buildCanonicalSyncPlanV1d1([
      record('service', 'SAP_PROJECT_PROCUREMENT', 'PR:100:00010', {
        requisitionNumber: '100',
        requisitionPosition: '00010',
        itemKind: 'SERVICE',
        uom: 'SRV',
      }),
    ]);
    expect(plan.summary.requisitionLines).toBe(1);
    expect(plan.materials).toHaveLength(0);
  });

  it('derives purchase order status from current open quantity', () => {
    expect(derivePurchaseOrderStatusV1d1([
      record('a', 'SAP_OPEN_PURCHASE_ORDERS', 'PO:1:00010', { orderedQuantity: 10, openQuantity: 10 }),
    ])).toBe('ORDERED');
    expect(derivePurchaseOrderStatusV1d1([
      record('a', 'SAP_OPEN_PURCHASE_ORDERS', 'PO:1:00010', { orderedQuantity: 10, openQuantity: 4 }),
    ])).toBe('PARTIAL');
    expect(derivePurchaseOrderStatusV1d1([
      record('a', 'SAP_OPEN_PURCHASE_ORDERS', 'PO:1:00010', { orderedQuantity: 10, openQuantity: 0 }),
    ])).toBe('RECEIVED');
  });
});
