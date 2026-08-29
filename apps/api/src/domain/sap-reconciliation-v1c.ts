export type SapReconciliationRecordV1c = {
  id: string;
  batchId: string;
  sourceKey: string;
  profileId: string;
  externalKey: string | null;
  normalized: Record<string, unknown>;
};

export type SapReconciliationCandidateV1c = {
  leftRecordId: string;
  rightRecordId: string;
  relationshipType: string;
  matchMethod: string;
  confidence: number;
  status: 'MATCHED' | 'PROPOSED' | 'AMBIGUOUS';
  evidence: Record<string, unknown>;
};

export type SapReconciliationConflictV1c = {
  code: string;
  recordId: string;
  details: Record<string, unknown>;
};

export type SapReconciliationPlanV1c = {
  candidates: SapReconciliationCandidateV1c[];
  conflicts: SapReconciliationConflictV1c[];
  summary: {
    recordsConsidered: number;
    exactMatches: number;
    proposedMatches: number;
    ambiguousMatches: number;
    conflicts: number;
    byRelationship: Record<string, number>;
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

function numberValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedPosition(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const clean = raw.replace(/\.0+$/, '');
  return /^\d+$/.test(clean) ? clean.padStart(5, '0') : clean;
}

function documentKey(prefix: 'PR' | 'PO', document: unknown, position: unknown): string | null {
  const number = text(document)?.replace(/\.0+$/, '') ?? null;
  const normalized = normalizedPosition(position);
  return number && normalized ? `${prefix}:${number}:${normalized}` : null;
}

export function requisitionKey(record: SapReconciliationRecordV1c): string | null {
  return documentKey('PR', record.normalized.requisitionNumber, record.normalized.requisitionPosition);
}

export function purchaseOrderKey(record: SapReconciliationRecordV1c): string | null {
  return documentKey('PO', record.normalized.purchaseOrderNumber, record.normalized.purchaseOrderPosition);
}

function procurementFingerprint(record: SapReconciliationRecordV1c): string | null {
  const pr = requisitionKey(record);
  const po = purchaseOrderKey(record);
  return pr && po ? `${pr}|${po}` : null;
}

function financialMovementFingerprint(record: SapReconciliationRecordV1c): string | null {
  const wbs = text(record.normalized.wbsElement);
  const material = text(record.normalized.materialCode)?.replace(/\.0+$/, '') ?? null;
  const postingDate = text(record.normalized.postingDate);
  const quantity = numberValue(record.normalized.quantity);
  if (!wbs || !material || !postingDate || quantity === null) return null;
  return `${wbs}|${material}|${postingDate}|${Math.abs(quantity).toFixed(6)}`;
}

function isReceiptMovement(record: SapReconciliationRecordV1c): boolean {
  const semantics = text(record.normalized.movementSemantics);
  return semantics === 'RECEIPT' || semantics === 'RECEIPT_REVERSAL';
}

function isFinanciallyReconcilableMovement(record: SapReconciliationRecordV1c): boolean {
  const semantics = text(record.normalized.movementSemantics);
  return semantics === 'RECEIPT'
    || semantics === 'RECEIPT_REVERSAL'
    || semantics === 'ISSUE'
    || semantics === 'ISSUE_REVERSAL';
}

function expectedOriginalOperation(record: SapReconciliationRecordV1c): string | null {
  const semantics = text(record.normalized.movementSemantics);
  if (semantics === 'RECEIPT' || semantics === 'RECEIPT_REVERSAL') return 'RMWE';
  if (semantics === 'ISSUE' || semantics === 'ISSUE_REVERSAL') return 'RMWA';
  return null;
}

function indexBy(records: SapReconciliationRecordV1c[], keyOf: (record: SapReconciliationRecordV1c) => string | null) {
  const index = new Map<string, SapReconciliationRecordV1c[]>();
  for (const record of records) {
    const key = keyOf(record);
    if (!key) continue;
    const current = index.get(key) ?? [];
    current.push(record);
    index.set(key, current);
  }
  return index;
}

function pairKey(candidate: Pick<SapReconciliationCandidateV1c, 'leftRecordId' | 'rightRecordId' | 'relationshipType'>): string {
  return `${candidate.relationshipType}|${candidate.leftRecordId}|${candidate.rightRecordId}`;
}

function pushUnique(
  target: SapReconciliationCandidateV1c[],
  seen: Set<string>,
  candidate: SapReconciliationCandidateV1c,
): void {
  if (candidate.leftRecordId === candidate.rightRecordId) return;
  const key = pairKey(candidate);
  if (seen.has(key)) return;
  seen.add(key);
  target.push(candidate);
}

export function buildSapReconciliationPlanV1c(records: SapReconciliationRecordV1c[]): SapReconciliationPlanV1c {
  const candidates: SapReconciliationCandidateV1c[] = [];
  const conflicts: SapReconciliationConflictV1c[] = [];
  const seen = new Set<string>();

  const projectProcurement = records.filter((record) => record.sourceKey === 'SAP_PROJECT_PROCUREMENT');
  const openOrders = records.filter((record) => record.sourceKey === 'SAP_OPEN_PURCHASE_ORDERS');
  const commitments = records.filter((record) => record.sourceKey === 'SAP_PROCUREMENT_COMMITMENTS');
  const movements = records.filter((record) => record.sourceKey === 'SAP_MATERIAL_MOVEMENTS');
  const actualCosts = records.filter((record) => record.sourceKey === 'SAP_PROJECT_ACTUAL_COSTS');

  const openByProcurementFingerprint = indexBy(openOrders, procurementFingerprint);
  const projectByPr = indexBy(projectProcurement, requisitionKey);
  const projectByPo = indexBy(projectProcurement, purchaseOrderKey);
  const openByPo = indexBy(openOrders, purchaseOrderKey);
  const actualByFinancialFingerprint = indexBy(actualCosts, financialMovementFingerprint);

  // Project-procurement snapshots are the bridge that explicitly carries PR + position -> PO + position.
  for (const projectLine of projectProcurement) {
    const fingerprint = procurementFingerprint(projectLine);
    if (!fingerprint) continue;
    const matchingOrders = openByProcurementFingerprint.get(fingerprint) ?? [];
    if (matchingOrders.length === 1) {
      const orderLine = matchingOrders[0]!;
      pushUnique(candidates, seen, {
        leftRecordId: projectLine.id,
        rightRecordId: orderLine.id,
        relationshipType: 'REQUISITION_LINE_TO_PURCHASE_ORDER_LINE',
        matchMethod: 'REQUEST_AND_DOCUMENT_POSITION',
        confidence: 1,
        status: 'MATCHED',
        evidence: {
          requisitionKey: requisitionKey(projectLine),
          purchaseOrderKey: purchaseOrderKey(projectLine),
          deterministic: true,
        },
      });
    } else if (matchingOrders.length > 1) {
      conflicts.push({
        code: 'MULTIPLE_OPEN_ORDER_ROWS_FOR_PROCUREMENT_LINE',
        recordId: projectLine.id,
        details: { fingerprint, candidateRecordIds: matchingOrders.map((record) => record.id) },
      });
    }
  }

  // Enriched commitments can be attached exactly to the operational procurement line identity.
  for (const commitment of commitments) {
    if (!commitment.externalKey) continue;
    const targetRecords = commitment.externalKey.startsWith('PR:')
      ? projectByPr.get(commitment.externalKey) ?? []
      : commitment.externalKey.startsWith('PO:')
        ? [...(openByPo.get(commitment.externalKey) ?? []), ...(projectByPo.get(commitment.externalKey) ?? [])]
        : [];
    if (targetRecords.length === 1) {
      pushUnique(candidates, seen, {
        leftRecordId: commitment.id,
        rightRecordId: targetRecords[0]!.id,
        relationshipType: 'COMMITMENT_REFERENCE_TO_PROCUREMENT_LINE',
        matchMethod: 'EXACT_EXTERNAL_KEY',
        confidence: 1,
        status: 'MATCHED',
        evidence: { externalKey: commitment.externalKey, deterministic: true },
      });
    } else if (targetRecords.length > 1) {
      conflicts.push({
        code: 'MULTIPLE_PROCUREMENT_ROWS_FOR_COMMITMENT_REFERENCE',
        recordId: commitment.id,
        details: { externalKey: commitment.externalKey, candidateRecordIds: targetRecords.map((record) => record.id) },
      });
    }
  }

  // 101/102-style receipts can be related to PO + position exactly. Other movement types are not forced through PO.
  for (const movement of movements.filter(isReceiptMovement)) {
    const poKey = purchaseOrderKey(movement);
    if (!poKey) continue;
    const preferredOpenOrders = openByPo.get(poKey) ?? [];
    const fallbackProjectLines = projectByPo.get(poKey) ?? [];
    const targets = preferredOpenOrders.length > 0 ? preferredOpenOrders : fallbackProjectLines;
    if (targets.length === 1) {
      pushUnique(candidates, seen, {
        leftRecordId: targets[0]!.id,
        rightRecordId: movement.id,
        relationshipType: 'PURCHASE_ORDER_LINE_TO_MATERIAL_RECEIPT',
        matchMethod: 'DOCUMENT_POSITION',
        confidence: 1,
        status: 'MATCHED',
        evidence: {
          purchaseOrderKey: poKey,
          sapMovementType: text(movement.normalized.sapMovementType),
          movementSemantics: text(movement.normalized.movementSemantics),
          deterministic: true,
        },
      });
    } else if (targets.length > 1) {
      conflicts.push({
        code: 'MULTIPLE_PURCHASE_ORDER_ROWS_FOR_RECEIPT',
        recordId: movement.id,
        details: { purchaseOrderKey: poKey, candidateRecordIds: targets.map((record) => record.id) },
      });
    }
  }

  // Current exports do not expose material-document item identity on both sides. Therefore this is only a scored proposal.
  for (const movement of movements.filter(isFinanciallyReconcilableMovement)) {
    const fingerprint = financialMovementFingerprint(movement);
    if (!fingerprint) continue;
    const financialRows = actualByFinancialFingerprint.get(fingerprint) ?? [];
    if (financialRows.length === 0) continue;
    const expectedOperation = expectedOriginalOperation(movement);
    const matchingOperationRows = expectedOperation
      ? financialRows.filter((record) => text(record.normalized.originalOperation)?.toUpperCase() === expectedOperation)
      : [];
    const effectiveRows = matchingOperationRows.length > 0 ? matchingOperationRows : financialRows;
    const unique = effectiveRows.length === 1;
    for (const actual of effectiveRows) {
      pushUnique(candidates, seen, {
        leftRecordId: movement.id,
        rightRecordId: actual.id,
        relationshipType: 'MATERIAL_MOVEMENT_TO_ACTUAL_COST',
        matchMethod: 'HEURISTIC_WBS_MATERIAL_DATE_QUANTITY',
        confidence: unique && matchingOperationRows.length === 1 ? 0.95 : unique ? 0.9 : 0.7,
        status: unique ? 'PROPOSED' : 'AMBIGUOUS',
        evidence: {
          fingerprint,
          candidateCount: effectiveRows.length,
          expectedOriginalOperation: expectedOperation,
          matchedOriginalOperation: matchingOperationRows.includes(actual),
          deterministic: false,
          requiresMaterialDocumentItemForExactMatch: true,
        },
      });
    }
  }

  const byRelationship: Record<string, number> = {};
  for (const candidate of candidates) {
    byRelationship[candidate.relationshipType] = (byRelationship[candidate.relationshipType] ?? 0) + 1;
  }

  return {
    candidates,
    conflicts,
    summary: {
      recordsConsidered: records.length,
      exactMatches: candidates.filter((candidate) => candidate.status === 'MATCHED').length,
      proposedMatches: candidates.filter((candidate) => candidate.status === 'PROPOSED').length,
      ambiguousMatches: candidates.filter((candidate) => candidate.status === 'AMBIGUOUS').length,
      conflicts: conflicts.length,
      byRelationship,
    },
  };
}
