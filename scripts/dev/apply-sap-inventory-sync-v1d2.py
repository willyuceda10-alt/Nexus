from pathlib import Path

root = Path(__file__).resolve().parents[2]

# -----------------------------------------------------------------------------
# 1. Extend the SAP movement parser with exact material-document item identity.
# -----------------------------------------------------------------------------
parser_path = root / 'apps/api/src/domain/sap-source-detection-v1.ts'
parser = parser_path.read_text()

old_optional = """      'Fecha de entrada',
      'Referencia',
    ]),
"""
new_optional = """      'Fecha de entrada',
      'Referencia',
      'Documento material',
      'Ejercicio',
      'Posición doc.material',
    ]),
"""
if new_optional not in parser:
    if old_optional not in parser:
        raise SystemExit('movement optional-header anchor missing')
    parser = parser.replace(old_optional, new_optional, 1)

position_anchor = """function asPosition(value: SapCellScalar | undefined): string | null {
  const document = asDocument(value);
  if (!document) return null;
  return /^\d+$/.test(document) ? document.padStart(5, '0') : document;
}
"""
material_item_helper = position_anchor + """
function asMaterialDocumentItem(value: SapCellScalar | undefined): string | null {
  const document = asDocument(value);
  if (!document) return null;
  return /^\d+$/.test(document) ? document.padStart(4, '0') : document;
}
"""
if material_item_helper not in parser:
    if position_anchor not in parser:
        raise SystemExit('position helper anchor missing')
    parser = parser.replace(position_anchor, material_item_helper, 1)

old_pick = """function pick(map: Map<string, SapCellScalar>, header: string): SapCellScalar | undefined {
  return map.get(normalizeSapHeader(header));
}
"""
new_pick = old_pick + """
function pickFirst(map: Map<string, SapCellScalar>, candidateHeaders: string[]): SapCellScalar | undefined {
  for (const header of candidateHeaders) {
    const value = pick(map, header);
    if (value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '')) return value;
  }
  return undefined;
}
"""
if new_pick not in parser:
    if old_pick not in parser:
        raise SystemExit('pick helper anchor missing')
    parser = parser.replace(old_pick, new_pick, 1)

old_movement = """  } else if (profileId === 'material_movements_v1') {
    const movementType = asDocument(pick(map, 'Clase de movimiento'));
    fields = compact({
      plant: asText(pick(map, 'Centro')),
      warehouse: asText(pick(map, 'Almacén')),
      materialCode: asDocument(pick(map, 'Material')),
      materialDescription: asText(pick(map, 'Texto breve de material')),
      baseUom: asText(pick(map, 'Unidad medida base')),
      quantity: asNumber(pick(map, 'Cantidad')),
      sapMovementType: movementType,
      movementSemantics: movementSemantics(movementType),
      entryDate: asIsoDate(pick(map, 'Fecha de entrada')),
      postingDate: asIsoDate(pick(map, 'Fe.contabilización')),
      reservationNumber: asDocument(pick(map, 'Nº reserva')),
      reservationPosition: asPosition(pick(map, 'Nº pos.reserva traslado')),
      reference: asText(pick(map, 'Referencia')),
      documentHeaderText: asText(pick(map, 'Texto cab.documento')),
      userName: asText(pick(map, 'Nombre del usuario')),
      purchaseOrderNumber: asDocument(pick(map, 'Pedido')),
      purchaseOrderPosition: asPosition(pick(map, 'Posición')),
      wbsElement: asText(pick(map, 'Elemento PEP')),
    });
    if (!movementType || asNumber(pick(map, 'Cantidad')) === null) errors.push('MOVEMENT_CORE_FIELDS_MISSING');
    warnings.push('MATERIAL_DOCUMENT_IDENTITY_NOT_AVAILABLE');
"""
new_movement = """  } else if (profileId === 'material_movements_v1') {
    const movementType = asDocument(pick(map, 'Clase de movimiento'));
    const materialDocumentNumber = asDocument(pickFirst(map, [
      'Documento material', 'Nº documento material', 'Nº doc.material',
    ]));
    const materialDocumentYear = asDocument(pickFirst(map, [
      'Ejercicio', 'Ejercicio doc.material', 'Ejercicio documento material',
    ]));
    const materialDocumentItem = asMaterialDocumentItem(pickFirst(map, [
      'Posición doc.material', 'Posición documento material', 'Pos.doc.material',
    ]));
    fields = compact({
      plant: asText(pick(map, 'Centro')),
      warehouse: asText(pick(map, 'Almacén')),
      materialCode: asDocument(pick(map, 'Material')),
      materialDescription: asText(pick(map, 'Texto breve de material')),
      baseUom: asText(pick(map, 'Unidad medida base')),
      quantity: asNumber(pick(map, 'Cantidad')),
      sapMovementType: movementType,
      movementSemantics: movementSemantics(movementType),
      entryDate: asIsoDate(pick(map, 'Fecha de entrada')),
      postingDate: asIsoDate(pick(map, 'Fe.contabilización')),
      reservationNumber: asDocument(pick(map, 'Nº reserva')),
      reservationPosition: asPosition(pick(map, 'Nº pos.reserva traslado')),
      reference: asText(pick(map, 'Referencia')),
      documentHeaderText: asText(pick(map, 'Texto cab.documento')),
      userName: asText(pick(map, 'Nombre del usuario')),
      purchaseOrderNumber: asDocument(pick(map, 'Pedido')),
      purchaseOrderPosition: asPosition(pick(map, 'Posición')),
      wbsElement: asText(pick(map, 'Elemento PEP')),
      materialDocumentNumber,
      materialDocumentYear,
      materialDocumentItem,
    });
    if (!movementType || asNumber(pick(map, 'Cantidad')) === null) errors.push('MOVEMENT_CORE_FIELDS_MISSING');
    if (materialDocumentNumber && materialDocumentYear && materialDocumentItem) {
      externalKey = `MATDOC:${materialDocumentYear}:${materialDocumentNumber}:${materialDocumentItem}`;
    } else {
      warnings.push('MATERIAL_DOCUMENT_IDENTITY_NOT_AVAILABLE');
    }
"""
if new_movement not in parser:
    if old_movement not in parser:
        raise SystemExit('material movement normalization anchor missing')
    parser = parser.replace(old_movement, new_movement, 1)

parser_path.write_text(parser)

# -----------------------------------------------------------------------------
# 2. Harden V1-D2 route: stale-link conflict + exact reversal guards.
# -----------------------------------------------------------------------------
route_path = root / 'apps/api/src/routes/sap-integration-inventory-sync-v1d2.ts'
route = route_path.read_text()

old_existing = """  if (existing) return { eligible: null, blocker: null, unchanged: true };
"""
new_existing = """  if (existing) {
    if (existing.canonical_entity_type !== 'INVENTORY_MOVEMENT') {
      return {
        eligible: null,
        unchanged: false,
        blocker: { recordId: candidate.recordId, externalKey: candidate.externalKey, code: 'MATERIAL_DOCUMENT_IDENTITY_LINK_CONFLICT' },
      };
    }
    return { eligible: null, blocker: null, unchanged: true };
  }
"""
if new_existing not in route:
    if old_existing not in route:
        raise SystemExit('existing MATDOC link anchor missing')
    route = route.replace(old_existing, new_existing, 1)

refresh_anchor = """async function refreshPurchaseOrderReceiptState(
"""
issue_helper = """async function syncedNetSapIssueQuantity(
  tx: Prisma.TransactionClient,
  tenantId: string,
  connectionId: string,
  warehouseId: string,
  materialId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<QuantityRow[]>(Prisma.sql`
    SELECT COALESCE(SUM(
      CASE
        WHEN link.metadata->>'sapMovementType' = '221' THEN movement.quantity
        WHEN link.metadata->>'sapMovementType' = '222' THEN -movement.quantity
        ELSE 0
      END
    ), 0) AS quantity
    FROM integration_entity_links link
    JOIN inventory_movements movement
      ON movement.id = link.canonical_entity_id
     AND movement.tenant_id = link.tenant_id
    WHERE link.tenant_id = ${tenantId}::uuid
      AND link.integration_connection_id = ${connectionId}::uuid
      AND link.external_entity_type = 'SAP_MATERIAL_DOCUMENT_ITEM'
      AND link.canonical_entity_type = 'INVENTORY_MOVEMENT'
      AND movement.warehouse_id = ${warehouseId}::uuid
      AND movement.material_id = ${materialId}::uuid
  `);
  return Math.max(0, numberOf(rows[0]?.quantity));
}

"""
if issue_helper not in route:
    if refresh_anchor not in route:
        raise SystemExit('purchase order refresh anchor missing')
    route = route.replace(refresh_anchor, issue_helper + refresh_anchor, 1)

old_po_lookup = """      const poLine = candidate.purchaseOrderExternalKey
        ? await findPurchaseOrderLine(tx, tenantId, connectionId, candidate.purchaseOrderExternalKey)
        : null;
"""
new_po_lookup = """      const needsPurchaseOrderReference = candidate.canonicalMovementType === 'RECEIPT'
        || candidate.canonicalMovementType === 'ADJUSTMENT_OUT';
      const poLine = needsPurchaseOrderReference && candidate.purchaseOrderExternalKey
        ? await findPurchaseOrderLine(tx, tenantId, connectionId, candidate.purchaseOrderExternalKey)
        : null;
"""
if new_po_lookup not in route:
    if old_po_lookup not in route:
        raise SystemExit('PO lookup anchor missing')
    route = route.replace(old_po_lookup, new_po_lookup, 1)

old_guard_tail = """      if (candidate.canonicalMovementType === 'ADJUSTMENT_OUT' && poLine) {
        const netReceived = await syncedReceiptQuantityForPoLine(tx, tenantId, poLine.id);
        if (candidate.quantity > netReceived) {
          return {
            kind: 'blocked' as const,
            blocker: {
              recordId: candidate.recordId,
              externalKey: candidate.externalKey,
              code: 'RECEIPT_REVERSAL_EXCEEDS_SYNCED_RECEIPTS',
            },
          };
        }
      }

      let goodsReceiptCreated = false;
"""
new_guard_tail = """      if (candidate.canonicalMovementType === 'ADJUSTMENT_OUT' && poLine) {
        const netReceived = await syncedReceiptQuantityForPoLine(tx, tenantId, poLine.id);
        if (candidate.quantity > netReceived) {
          return {
            kind: 'blocked' as const,
            blocker: {
              recordId: candidate.recordId,
              externalKey: candidate.externalKey,
              code: 'RECEIPT_REVERSAL_EXCEEDS_SYNCED_RECEIPTS',
            },
          };
        }
      }
      if (candidate.canonicalMovementType === 'ADJUSTMENT_IN' && candidate.sapMovementType === '222') {
        const netIssued = await syncedNetSapIssueQuantity(tx, tenantId, connectionId, warehouseId, material.id);
        if (candidate.quantity > netIssued) {
          return {
            kind: 'blocked' as const,
            blocker: {
              recordId: candidate.recordId,
              externalKey: candidate.externalKey,
              code: 'ISSUE_REVERSAL_EXCEEDS_SYNCED_ISSUES',
            },
          };
        }
      }

      let goodsReceiptCreated = false;
"""
if new_guard_tail not in route:
    if old_guard_tail not in route:
        raise SystemExit('movement reversal guard anchor missing')
    route = route.replace(old_guard_tail, new_guard_tail, 1)

route_path.write_text(route)

# -----------------------------------------------------------------------------
# 3. Register V1-D2 in the API runtime.
# -----------------------------------------------------------------------------
app_path = root / 'apps/api/src/app.ts'
app = app_path.read_text()
old_import = "import { sapIntegrationCanonicalSyncV1d1Routes } from './routes/sap-integration-canonical-sync-v1d1.js';\n"
new_import = old_import + "import { sapIntegrationInventorySyncV1d2Routes } from './routes/sap-integration-inventory-sync-v1d2.js';\n"
if new_import not in app:
    if old_import not in app:
        raise SystemExit('V1-D1 app import anchor missing')
    app = app.replace(old_import, new_import, 1)

old_register = "  await app.register(sapIntegrationCanonicalSyncV1d1Routes);\n"
new_register = old_register + "  await app.register(sapIntegrationInventorySyncV1d2Routes);\n"
if new_register not in app:
    if old_register not in app:
        raise SystemExit('V1-D1 app registration anchor missing')
    app = app.replace(old_register, new_register, 1)
app_path.write_text(app)

# -----------------------------------------------------------------------------
# 4. Add the V1-D2 end-to-end smoke to CI for when Actions quota is restored.
# -----------------------------------------------------------------------------
ci_path = root / '.github/workflows/ci.yml'
ci = ci_path.read_text()
anchor = """      - name: Verify persistent object approval lifecycle
"""
step = """      - name: Verify SAP exact inventory sync into Bridata PostgreSQL
        env:
          AUTH_MODE: dev
          DEV_AUTH_ENABLED: "true"
          DEV_USER_ID: 00000000-0000-4000-8000-000000000001
          DEV_TENANT_ID: 00000000-0000-4000-8000-000000000002
          INTEGRATION_STORAGE_MODE: memory
          INTEGRATION_PARSE_MAX_FILE_BYTES: "26214400"
        run: npx tsx apps/api/test/sap-integration-inventory-sync-v1d2-smoke.ts

"""
if step not in ci:
    if anchor not in ci:
        raise SystemExit('CI insertion anchor missing')
    ci = ci.replace(anchor, step + anchor, 1)
ci_path.write_text(ci)

Path(__file__).unlink()
print('SAP_INVENTORY_SYNC_V1D2_WIRING_OK')
