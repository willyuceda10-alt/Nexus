export type CanonicalSourceRecordV1d1 = {
  id: string;
  sourceKey: string;
  externalKey: string | null;
  normalized: Record<string, unknown>;
};

export type CanonicalSyncPlanV1d1 = {
  requisitions: CanonicalSourceRecordV1d1[];
  purchaseOrders: CanonicalSourceRecordV1d1[];
  materials: Array<{ code: string; description: string | null; uom: string }>;
  suppliers: Array<{ code: string; name: string }>;
  blockedMovements: Array<{ recordId: string; reason: string }>;
  summary: {
    requisitionLines: number;
    purchaseOrderLines: number;
    uniqueMaterials: number;
    uniqueSuppliers: number;
    blockedMovements: number;
  };
};

function text(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function materialCode(record: CanonicalSourceRecordV1d1): string | null {
  return text(record.normalized.materialCode)?.replace(/\.0+$/, '') ?? null;
}

function materialUom(record: CanonicalSourceRecordV1d1): string {
  return (
    text(record.normalized.uom)
    ?? text(record.normalized.orderUom)
    ?? text(record.normalized.baseUom)
    ?? 'UND'
  ).toUpperCase();
}

function stableSupplierCode(raw: string): string {
  const token = raw.trim().split(/\s+/)[0]?.replace(/[^A-Za-z0-9._-]/g, '') ?? '';
  if (token && token.length <= 50) return token.toUpperCase();
  const sanitized = raw.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return sanitized.slice(0, 50) || 'SAP_SUPPLIER';
}

export function buildCanonicalSyncPlanV1d1(records: CanonicalSourceRecordV1d1[]): CanonicalSyncPlanV1d1 {
  const requisitions = records.filter((record) => (
    record.sourceKey === 'SAP_PROJECT_PROCUREMENT'
    && record.externalKey?.startsWith('PR:')
    && text(record.normalized.requisitionNumber)
    && text(record.normalized.requisitionPosition)
  ));

  const purchaseOrders = records.filter((record) => (
    record.sourceKey === 'SAP_OPEN_PURCHASE_ORDERS'
    && record.externalKey?.startsWith('PO:')
    && text(record.normalized.purchaseOrderNumber)
    && text(record.normalized.purchaseOrderPosition)
  ));

  const materialsByCode = new Map<string, { code: string; description: string | null; uom: string }>();
  for (const record of [...requisitions, ...purchaseOrders]) {
    const code = materialCode(record);
    if (!code) continue;
    const current = materialsByCode.get(code);
    const description = text(record.normalized.description) ?? current?.description ?? null;
    materialsByCode.set(code, { code, description, uom: materialUom(record) });
  }

  const suppliersByCode = new Map<string, { code: string; name: string }>();
  for (const record of purchaseOrders) {
    const raw = text(record.normalized.supplierOrSupplyingPlant);
    if (!raw) continue;
    const code = stableSupplierCode(raw);
    suppliersByCode.set(code, { code, name: raw.slice(0, 255) });
  }

  const blockedMovements = records
    .filter((record) => record.sourceKey === 'SAP_MATERIAL_MOVEMENTS')
    .map((record) => ({
      recordId: record.id,
      reason: 'MATERIAL_DOCUMENT_ITEM_IDENTITY_REQUIRED',
    }));

  return {
    requisitions,
    purchaseOrders,
    materials: [...materialsByCode.values()].sort((a, b) => a.code.localeCompare(b.code)),
    suppliers: [...suppliersByCode.values()].sort((a, b) => a.code.localeCompare(b.code)),
    blockedMovements,
    summary: {
      requisitionLines: requisitions.length,
      purchaseOrderLines: purchaseOrders.length,
      uniqueMaterials: materialsByCode.size,
      uniqueSuppliers: suppliersByCode.size,
      blockedMovements: blockedMovements.length,
    },
  };
}

export function derivePurchaseOrderStatusV1d1(rows: CanonicalSourceRecordV1d1[]): 'ORDERED' | 'PARTIAL' | 'RECEIVED' {
  let ordered = 0;
  let open = 0;
  for (const row of rows) {
    const orderedQty = Number(row.normalized.orderedQuantity ?? 0);
    const openQty = Number(row.normalized.openQuantity ?? 0);
    if (Number.isFinite(orderedQty)) ordered += Math.max(0, orderedQty);
    if (Number.isFinite(openQty)) open += Math.max(0, openQty);
  }
  if (ordered > 0 && open <= 0) return 'RECEIVED';
  if (ordered > 0 && open < ordered) return 'PARTIAL';
  return 'ORDERED';
}
