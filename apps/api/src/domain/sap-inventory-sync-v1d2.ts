export type SapInventorySourceRecordV1d2 = {
  id: string;
  sourceKey: string;
  externalKey: string | null;
  normalized: Record<string, unknown>;
};

export type SapInventoryMovementCandidateV1d2 = {
  recordId: string;
  externalKey: string;
  materialDocumentNumber: string;
  fiscalYear: string;
  materialDocumentItem: string;
  materialCode: string;
  plant: string;
  warehouse: string;
  warehouseCode: string;
  quantity: number;
  postingDate: string | null;
  sapMovementType: string;
  canonicalMovementType: 'RECEIPT' | 'ISSUE' | 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT';
  purchaseOrderNumber: string | null;
  purchaseOrderPosition: string | null;
  purchaseOrderExternalKey: string | null;
  wbsElement: string | null;
};

export type SapInventorySyncPlanV1d2 = {
  candidates: SapInventoryMovementCandidateV1d2[];
  blockers: Array<{ recordId: string; code: string }>;
  summary: {
    movementRecords: number;
    exactIdentityCandidates: number;
    blocked: number;
    receipts: number;
    receiptReversals: number;
    issues: number;
    issueReversals: number;
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

function positiveQuantity(value: unknown): number | null {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value.trim().replace(',', '.'))
      : Number.NaN;
  if (!Number.isFinite(parsed) || parsed === 0) return null;
  return Math.abs(parsed);
}

function canonicalMovementType(semantics: string | null): SapInventoryMovementCandidateV1d2['canonicalMovementType'] | null {
  if (semantics === 'RECEIPT') return 'RECEIPT';
  if (semantics === 'RECEIPT_REVERSAL') return 'ADJUSTMENT_OUT';
  if (semantics === 'ISSUE') return 'ISSUE';
  if (semantics === 'ISSUE_REVERSAL') return 'ADJUSTMENT_IN';
  return null;
}

export function canonicalWarehouseCodeV1d2(plant: string, warehouse: string): string {
  const normalizedPlant = plant.trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '_');
  const normalizedWarehouse = warehouse.trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '_');
  return `${normalizedPlant}:${normalizedWarehouse}`.slice(0, 50);
}

export function buildSapInventorySyncPlanV1d2(records: SapInventorySourceRecordV1d2[]): SapInventorySyncPlanV1d2 {
  const movementRecords = records.filter((record) => record.sourceKey === 'SAP_MATERIAL_MOVEMENTS');
  const candidates: SapInventoryMovementCandidateV1d2[] = [];
  const blockers: Array<{ recordId: string; code: string }> = [];

  for (const record of movementRecords) {
    const materialDocumentNumber = text(record.normalized.materialDocumentNumber);
    const fiscalYear = text(record.normalized.materialDocumentYear) ?? text(record.normalized.fiscalYear);
    const materialDocumentItem = text(record.normalized.materialDocumentItem);
    const materialCode = text(record.normalized.materialCode)?.replace(/\.0+$/, '') ?? null;
    const plant = text(record.normalized.plant);
    const warehouse = text(record.normalized.warehouse);
    const quantity = positiveQuantity(record.normalized.quantity);
    const sapMovementType = text(record.normalized.sapMovementType);
    const semantics = text(record.normalized.movementSemantics);
    const movementType = canonicalMovementType(semantics);

    if (!record.externalKey?.startsWith('MATDOC:') || !materialDocumentNumber || !fiscalYear || !materialDocumentItem) {
      blockers.push({ recordId: record.id, code: 'MATERIAL_DOCUMENT_ITEM_IDENTITY_REQUIRED' });
      continue;
    }
    if (!materialCode) {
      blockers.push({ recordId: record.id, code: 'MATERIAL_CODE_REQUIRED' });
      continue;
    }
    if (!plant || !warehouse) {
      blockers.push({ recordId: record.id, code: 'PLANT_AND_WAREHOUSE_REQUIRED' });
      continue;
    }
    if (!quantity) {
      blockers.push({ recordId: record.id, code: 'MOVEMENT_QUANTITY_REQUIRED' });
      continue;
    }
    if (!sapMovementType || !movementType) {
      blockers.push({ recordId: record.id, code: 'MOVEMENT_SEMANTICS_NOT_SAFE_FOR_CANONICAL_SYNC' });
      continue;
    }

    const purchaseOrderNumber = text(record.normalized.purchaseOrderNumber);
    const purchaseOrderPosition = text(record.normalized.purchaseOrderPosition);
    candidates.push({
      recordId: record.id,
      externalKey: record.externalKey,
      materialDocumentNumber,
      fiscalYear,
      materialDocumentItem,
      materialCode,
      plant,
      warehouse,
      warehouseCode: canonicalWarehouseCodeV1d2(plant, warehouse),
      quantity,
      postingDate: text(record.normalized.postingDate),
      sapMovementType,
      canonicalMovementType: movementType,
      purchaseOrderNumber,
      purchaseOrderPosition,
      purchaseOrderExternalKey: purchaseOrderNumber && purchaseOrderPosition
        ? `PO:${purchaseOrderNumber}:${purchaseOrderPosition}`
        : null,
      wbsElement: text(record.normalized.wbsElement),
    });
  }

  return {
    candidates,
    blockers,
    summary: {
      movementRecords: movementRecords.length,
      exactIdentityCandidates: candidates.length,
      blocked: blockers.length,
      receipts: candidates.filter((item) => item.canonicalMovementType === 'RECEIPT').length,
      receiptReversals: candidates.filter((item) => item.canonicalMovementType === 'ADJUSTMENT_OUT').length,
      issues: candidates.filter((item) => item.canonicalMovementType === 'ISSUE').length,
      issueReversals: candidates.filter((item) => item.canonicalMovementType === 'ADJUSTMENT_IN').length,
    },
  };
}
