export type InventoryMovementTypeV2 =
  | 'RECEIPT'
  | 'ISSUE'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT';

export interface InventoryMovementV2Input {
  movementType: InventoryMovementTypeV2;
  quantity: number;
}

export interface OpenPurchaseSupplyV2 {
  quantity: number;
  expectedDate: string | null;
}

export interface MaterialAvailabilityV2Input {
  requiredQty: number;
  issuedQty: number;
  onHandQty: number;
  ownReservedQty: number;
  otherReservedQty: number;
  requiredDate: string;
  today: string;
  openPurchaseSupply: OpenPurchaseSupplyV2[];
}

export type MaterialSupplyStateV2 =
  | 'FULFILLED'
  | 'RESERVED'
  | 'AVAILABLE'
  | 'ON_ORDER'
  | 'LATE'
  | 'SHORTAGE';

export type MaterialRiskLevelV2 = 'NONE' | 'WATCH' | 'HIGH' | 'CRITICAL';

export interface MaterialAvailabilityV2Result {
  state: MaterialSupplyStateV2;
  riskLevel: MaterialRiskLevelV2;
  remainingQty: number;
  onHandQty: number;
  reservedQty: number;
  competingReservedQty: number;
  availableQty: number;
  onOrderQty: number;
  projectedQty: number;
  deficitQty: number;
  projectedAvailabilityDate: string | null;
  requiredDate: string;
  lateByDays: number;
  taskAtRisk: boolean;
}

export class MaterialInventoryV2ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MaterialInventoryV2ValidationError';
  }
}

function finiteNonNegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new MaterialInventoryV2ValidationError(`${field} must be finite and non-negative.`);
  }
  return value;
}

function roundQty(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function dateOnly(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new MaterialInventoryV2ValidationError(`${field} must use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new MaterialInventoryV2ValidationError(`${field} is invalid.`);
  }
  return value;
}

function dayDiff(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00.000Z`).getTime();
  const b = new Date(`${to}T00:00:00.000Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function movementSignedQuantityV2(movement: InventoryMovementV2Input): number {
  const quantity = finiteNonNegative(movement.quantity, 'quantity');
  if (quantity === 0) return 0;
  switch (movement.movementType) {
    case 'RECEIPT':
    case 'TRANSFER_IN':
    case 'ADJUSTMENT_IN':
      return quantity;
    case 'ISSUE':
    case 'TRANSFER_OUT':
    case 'ADJUSTMENT_OUT':
      return -quantity;
  }
}

export function calculateOnHandV2(movements: InventoryMovementV2Input[]): number {
  return roundQty(movements.reduce((sum, movement) => sum + movementSignedQuantityV2(movement), 0));
}

export function calculateMaterialAvailabilityV2(
  input: MaterialAvailabilityV2Input,
): MaterialAvailabilityV2Result {
  const requiredQty = finiteNonNegative(input.requiredQty, 'requiredQty');
  const issuedQty = finiteNonNegative(input.issuedQty, 'issuedQty');
  const onHandQty = finiteNonNegative(input.onHandQty, 'onHandQty');
  const ownReservedQty = finiteNonNegative(input.ownReservedQty, 'ownReservedQty');
  const otherReservedQty = finiteNonNegative(input.otherReservedQty, 'otherReservedQty');
  const requiredDate = dateOnly(input.requiredDate, 'requiredDate');
  const today = dateOnly(input.today, 'today');

  const remainingQty = roundQty(Math.max(0, requiredQty - issuedQty));
  const effectiveOwnReservation = roundQty(Math.min(remainingQty, ownReservedQty));
  const unreservedRemainingQty = roundQty(Math.max(0, remainingQty - effectiveOwnReservation));
  const freeAvailableQty = roundQty(Math.max(0, onHandQty - effectiveOwnReservation - otherReservedQty));
  const supplies = input.openPurchaseSupply
    .map((supply) => ({
      quantity: finiteNonNegative(supply.quantity, 'openPurchaseSupply.quantity'),
      expectedDate: supply.expectedDate ? dateOnly(supply.expectedDate, 'expectedDate') : null,
    }))
    .filter((supply) => supply.quantity > 0)
    .sort((a, b) => {
      if (!a.expectedDate && !b.expectedDate) return 0;
      if (!a.expectedDate) return 1;
      if (!b.expectedDate) return -1;
      return a.expectedDate.localeCompare(b.expectedDate);
    });

  const onOrderQty = roundQty(supplies.reduce((sum, supply) => sum + supply.quantity, 0));
  const projectedQty = roundQty(effectiveOwnReservation + freeAvailableQty + onOrderQty);
  const deficitQty = roundQty(Math.max(0, remainingQty - projectedQty));

  const common = {
    remainingQty,
    onHandQty,
    reservedQty: effectiveOwnReservation,
    competingReservedQty: otherReservedQty,
    availableQty: freeAvailableQty,
    onOrderQty,
    projectedQty,
    requiredDate,
  };

  if (remainingQty === 0) {
    return {
      state: 'FULFILLED', riskLevel: 'NONE', ...common, deficitQty: 0,
      projectedAvailabilityDate: today, lateByDays: 0, taskAtRisk: false,
    };
  }

  if (effectiveOwnReservation >= remainingQty) {
    return {
      state: 'RESERVED', riskLevel: 'NONE', ...common, deficitQty: 0,
      projectedAvailabilityDate: today, lateByDays: 0, taskAtRisk: false,
    };
  }

  if (freeAvailableQty >= unreservedRemainingQty) {
    return {
      state: 'AVAILABLE', riskLevel: 'NONE', ...common, deficitQty: 0,
      projectedAvailabilityDate: today, lateByDays: 0, taskAtRisk: false,
    };
  }

  const shortageAfterStock = roundQty(Math.max(0, unreservedRemainingQty - freeAvailableQty));
  let cumulative = 0;
  let projectedAvailabilityDate: string | null = null;
  for (const supply of supplies) {
    cumulative = roundQty(cumulative + supply.quantity);
    if (cumulative >= shortageAfterStock) {
      projectedAvailabilityDate = supply.expectedDate;
      break;
    }
  }

  if (deficitQty > 0 || !projectedAvailabilityDate) {
    const overdue = requiredDate < today;
    return {
      state: 'SHORTAGE',
      riskLevel: overdue ? 'CRITICAL' : 'HIGH',
      ...common,
      deficitQty,
      projectedAvailabilityDate,
      lateByDays: overdue ? Math.max(0, dayDiff(requiredDate, today)) : 0,
      taskAtRisk: true,
    };
  }

  const lateByDays = Math.max(0, dayDiff(requiredDate, projectedAvailabilityDate));
  const late = projectedAvailabilityDate > requiredDate;
  return {
    state: late ? 'LATE' : 'ON_ORDER',
    riskLevel: late ? (requiredDate < today ? 'CRITICAL' : 'HIGH') : 'WATCH',
    ...common,
    deficitQty: 0,
    projectedAvailabilityDate,
    lateByDays,
    taskAtRisk: late,
  };
}
