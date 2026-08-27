import { describe, expect, it } from 'vitest';
import {
  calculateMaterialAvailabilityV2,
  calculateOnHandV2,
} from './material-inventory-v2.js';

describe('material inventory engine v2', () => {
  it('derives on-hand from the immutable movement ledger', () => {
    expect(calculateOnHandV2([
      { movementType: 'RECEIPT', quantity: 100 },
      { movementType: 'ISSUE', quantity: 35 },
      { movementType: 'ADJUSTMENT_IN', quantity: 5 },
      { movementType: 'TRANSFER_OUT', quantity: 10 },
    ])).toBe(60);
  });

  it('marks stock as available when current free inventory covers demand', () => {
    const result = calculateMaterialAvailabilityV2({
      requiredQty: 40,
      issuedQty: 0,
      onHandQty: 80,
      reservedQty: 20,
      requiredDate: '2026-08-30',
      today: '2026-08-26',
      openPurchaseSupply: [],
    });
    expect(result.state).toBe('AVAILABLE');
    expect(result.availableQty).toBe(60);
    expect(result.taskAtRisk).toBe(false);
  });

  it('uses purchase order dates to detect a late material risk', () => {
    const result = calculateMaterialAvailabilityV2({
      requiredQty: 100,
      issuedQty: 0,
      onHandQty: 20,
      reservedQty: 0,
      requiredDate: '2026-08-29',
      today: '2026-08-26',
      openPurchaseSupply: [
        { quantity: 30, expectedDate: '2026-08-28' },
        { quantity: 50, expectedDate: '2026-09-02' },
      ],
    });
    expect(result.state).toBe('LATE');
    expect(result.projectedAvailabilityDate).toBe('2026-09-02');
    expect(result.lateByDays).toBe(4);
    expect(result.taskAtRisk).toBe(true);
  });

  it('detects a structural shortage even when purchase orders exist', () => {
    const result = calculateMaterialAvailabilityV2({
      requiredQty: 100,
      issuedQty: 10,
      onHandQty: 20,
      reservedQty: 5,
      requiredDate: '2026-08-29',
      today: '2026-08-26',
      openPurchaseSupply: [{ quantity: 30, expectedDate: '2026-08-28' }],
    });
    expect(result.state).toBe('SHORTAGE');
    expect(result.deficitQty).toBe(45);
    expect(result.riskLevel).toBe('HIGH');
    expect(result.taskAtRisk).toBe(true);
  });
});
