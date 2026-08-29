export type SapLogicalSourceKey =
  | 'SAP_PROCUREMENT_COMMITMENTS'
  | 'SAP_PROJECT_PROCUREMENT'
  | 'SAP_OPEN_PURCHASE_ORDERS'
  | 'SAP_MATERIAL_MOVEMENTS'
  | 'SAP_PROJECT_ACTUAL_COSTS';

export type SapParserProfileId =
  | 'commitments_enriched_v1'
  | 'commitments_legacy_v1'
  | 'project_procurement_v1'
  | 'open_purchase_orders_v1'
  | 'material_movements_v1'
  | 'project_actual_costs_v1';

export type SapCellScalar = string | number | boolean | null;

export type SapSourceDetection = {
  profileId: SapParserProfileId;
  sourceKey: SapLogicalSourceKey;
  displayName: string;
  confidence: number;
  matchedRequired: string[];
  matchedOptional: string[];
};

export type SapNormalizedRow = {
  fields: Record<string, SapCellScalar>;
  externalKey: string | null;
  warnings: string[];
  errors: string[];
};

type Profile = {
  id: SapParserProfileId;
  sourceKey: SapLogicalSourceKey;
  displayName: string;
  required: string[];
  optional: string[];
  forbidden?: string[];
};

export function normalizeSapHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[º°]/g, ' n ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function headers(values: string[]): string[] {
  return values.map(normalizeSapHeader);
}

const profiles: Profile[] = [
  {
    id: 'commitments_enriched_v1',
    sourceKey: 'SAP_PROCUREMENT_COMMITMENTS',
    displayName: 'Compromisos de compras SAP',
    required: headers([
      'Elemento PEP',
      'Nº docum.refer.',
      'Pos.referencia',
      'Tipo de documento de referencia',
      'Tipo de valor',
      'Operación',
    ]),
    optional: headers([
      'Material',
      'Proveedor',
      'Indicador de borrado',
      'Clase doc. referencia',
      'Definición del proyecto',
      'Ejercicio',
      'Cantidad total',
      'Val/Mon.so.CO',
    ]),
  },
  {
    id: 'project_procurement_v1',
    sourceKey: 'SAP_PROJECT_PROCUREMENT',
    displayName: 'Seguimiento de aprovisionamiento por proyecto',
    required: headers([
      'Solicitud de pedido',
      'Pos.solicitud pedido',
      'Pedido',
      'Posición de pedido',
      'Entrada mercancías',
    ]),
    optional: headers([
      'Material',
      'Cantidad solicitada',
      'Valor total',
      'Nº reserva',
      'Tipo de imputación',
      'Centro',
      'Solicitante',
    ]),
  },
  {
    id: 'open_purchase_orders_v1',
    sourceKey: 'SAP_OPEN_PURCHASE_ORDERS',
    displayName: 'Pedidos abiertos y suministro pendiente SAP',
    required: headers([
      'Documento compras',
      'Por entregar (cantidad)',
      'Solicitud de pedido',
      'Pos.solicitud pedido',
      'Posición',
    ]),
    optional: headers([
      'Cantidad de pedido',
      'Fecha de entrega',
      'Proveedor/Centro suministrador',
      'Material',
      'Precio neto',
      'Moneda',
      'Centro',
    ]),
  },
  {
    id: 'material_movements_v1',
    sourceKey: 'SAP_MATERIAL_MOVEMENTS',
    displayName: 'Movimientos de material SAP',
    required: headers([
      'Centro',
      'Almacén',
      'Cantidad',
      'Clase de movimiento',
      'Fe.contabilización',
      'Nº reserva',
      'Nº pos.reserva traslado',
    ]),
    optional: headers([
      'Material',
      'Pedido',
      'Posición',
      'Elemento PEP',
      'Fecha de entrada',
      'Referencia',
      'Documento material',
      'Ejercicio',
      'Posición doc.material',
    ]),
  },
  {
    id: 'project_actual_costs_v1',
    sourceKey: 'SAP_PROJECT_ACTUAL_COSTS',
    displayName: 'Costos reales por PEP SAP',
    required: headers([
      'Elemento PEP',
      'Tipo de valor',
      'Clase de documento',
      'Fe.contabilización',
      'Número de documento',
      'Operación',
      'Operación original',
    ]),
    optional: headers([
      'Definición del proyecto',
      'Clase de coste',
      'Material',
      'Cantidad total reg.',
      'Nº docum.refer.',
      'Indic.cargo/abono',
      'Val/Mon.so.CO',
      'Sociedad',
      'Ejercicio',
      'Posición documento',
    ]),
  },
  {
    id: 'commitments_legacy_v1',
    sourceKey: 'SAP_PROCUREMENT_COMMITMENTS',
    displayName: 'Compromisos de compras SAP',
    required: headers([
      'Clase de coste',
      'Elemento PEP',
      'Nº docum.refer.',
      'Val/Mon.so.CO',
      'Material',
      'Cantidad total',
    ]),
    optional: headers([
      'Fecha de cargo',
      'Usuario',
      'Unidad de medida',
      'Denom.clase de coste',
    ]),
    forbidden: headers(['Pos.referencia', 'Tipo de documento de referencia']),
  },
];

export function detectSapSource(headerValues: string[]): SapSourceDetection | null {
  const normalized = new Set(headerValues.map(normalizeSapHeader).filter(Boolean));
  const candidates = profiles
    .map((profile) => {
      if (profile.forbidden?.some((header) => normalized.has(header))) return null;
      const matchedRequired = profile.required.filter((header) => normalized.has(header));
      if (matchedRequired.length !== profile.required.length) return null;
      const matchedOptional = profile.optional.filter((header) => normalized.has(header));
      const optionalScore = profile.optional.length === 0 ? 1 : matchedOptional.length / profile.optional.length;
      const confidence = Math.min(1, 0.82 + optionalScore * 0.18);
      return {
        profileId: profile.id,
        sourceKey: profile.sourceKey,
        displayName: profile.displayName,
        confidence,
        matchedRequired,
        matchedOptional,
      } satisfies SapSourceDetection;
    })
    .filter((candidate): candidate is SapSourceDetection => candidate !== null)
    .sort((left, right) => right.confidence - left.confidence);

  if (candidates.length === 0) return null;
  const first = candidates[0]!;
  const second = candidates[1];
  if (second && first.sourceKey !== second.sourceKey && Math.abs(first.confidence - second.confidence) < 0.03) {
    return null;
  }
  return first;
}

function asText(value: SapCellScalar | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const text = String(value).trim();
  return text === '' ? null : text;
}

function asNumber(value: SapCellScalar | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value).trim().replace(/\s/g, '').replace(',', '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function asDocument(value: SapCellScalar | undefined): string | null {
  const text = asText(value);
  if (!text) return null;
  return text.replace(/\.0+$/, '');
}

function asPosition(value: SapCellScalar | undefined): string | null {
  const document = asDocument(value);
  if (!document) return null;
  return /^\d+$/.test(document) ? document.padStart(5, '0') : document;
}

function asMaterialDocumentItem(value: SapCellScalar | undefined): string | null {
  const document = asDocument(value);
  if (!document) return null;
  return /^\d+$/.test(document) ? document.padStart(4, '0') : document;
}

function asAccountingDocumentItem(value: SapCellScalar | undefined): string | null {
  const document = asDocument(value);
  if (!document) return null;
  return /^\d+$/.test(document) ? document.padStart(3, '0') : document;
}

function asIsoDate(value: SapCellScalar | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = Math.round((value - 25569) * 86_400_000);
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(text);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      return date.toISOString().slice(0, 10);
    }
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function asBooleanFlag(value: SapCellScalar | undefined): boolean | null {
  const text = asText(value)?.toLowerCase();
  if (!text) return null;
  if (['si', 'sí', 'yes', 'true', 'x', '1'].includes(text)) return true;
  if (['no', 'false', '0'].includes(text)) return false;
  return null;
}

function toHeaderMap(cells: Array<{ header: string; value: SapCellScalar }>): Map<string, SapCellScalar> {
  const map = new Map<string, SapCellScalar>();
  for (const cell of cells) {
    const header = normalizeSapHeader(cell.header);
    if (!header || map.has(header)) continue;
    map.set(header, cell.value);
  }
  return map;
}

function pick(map: Map<string, SapCellScalar>, header: string): SapCellScalar | undefined {
  return map.get(normalizeSapHeader(header));
}

function pickFirst(map: Map<string, SapCellScalar>, candidateHeaders: string[]): SapCellScalar | undefined {
  for (const header of candidateHeaders) {
    const value = pick(map, header);
    if (value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '')) return value;
  }
  return undefined;
}

function present(value: SapCellScalar): boolean {
  return value !== null && !(typeof value === 'string' && value.trim() === '');
}

function compact(fields: Record<string, SapCellScalar>): Record<string, SapCellScalar> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => present(value)));
}

function movementSemantics(code: string | null): string | null {
  if (!code) return null;
  if (code === '101') return 'RECEIPT';
  if (code === '102' || code === '122') return 'RECEIPT_REVERSAL';
  if (code === '221') return 'ISSUE';
  if (code === '222') return 'ISSUE_REVERSAL';
  if (code === '311') return 'TRANSFER';
  if (['343', '344', '411', '412', '415', '416'].includes(code)) return 'ADJUSTMENT_OR_TRANSFER';
  return 'OTHER';
}

export function normalizeSapRow(
  profileId: SapParserProfileId,
  cells: Array<{ header: string; value: SapCellScalar }>,
): SapNormalizedRow {
  const map = toHeaderMap(cells);
  const warnings: string[] = [];
  const errors: string[] = [];
  let externalKey: string | null = null;
  let fields: Record<string, SapCellScalar> = {};

  if (profileId === 'project_procurement_v1') {
    const requisitionNumber = asDocument(pick(map, 'Solicitud de pedido'));
    const requisitionPosition = asPosition(pick(map, 'Pos.solicitud pedido'));
    const purchaseOrderNumber = asDocument(pick(map, 'Pedido'));
    const purchaseOrderPosition = asPosition(pick(map, 'Posición de pedido'));
    const materialCode = asDocument(pick(map, 'Material'));
    const uom = asText(pick(map, 'Unidad de medida'));
    fields = compact({
      requisitionNumber,
      requisitionPosition,
      requisitionCreatedBy: asText(pick(map, 'Creado por')),
      requisitionDate: asIsoDate(pick(map, 'Fecha de solicitud')),
      releaseDate: asIsoDate(pick(map, 'Fecha de liberación')),
      processingStatus: asText(pick(map, 'Status tratamiento')),
      purchasingGroup: asText(pick(map, 'Grupo de compras')),
      materialGroup: asText(pick(map, 'Grupo de artículos')),
      materialCode,
      description: asText(pick(map, 'Texto breve')),
      requestedQuantity: asNumber(pick(map, 'Cantidad solicitada')),
      uom,
      totalValue: asNumber(pick(map, 'Valor total')),
      currency: asText(pick(map, 'Moneda')),
      plant: asText(pick(map, 'Centro')),
      requester: asText(pick(map, 'Solicitante')),
      accountAssignmentType: asText(pick(map, 'Tipo de imputación')),
      purchaseOrderNumber,
      purchaseOrderPosition,
      goodsReceiptExpected: asBooleanFlag(pick(map, 'Entrada mercancías')),
      reservationNumber: asDocument(pick(map, 'Nº reserva')),
      blockedIndicator: asText(pick(map, 'Indicador de bloqueo')),
      itemKind: !materialCode && uom?.toUpperCase() === 'SRV' ? 'SERVICE' : 'PHYSICAL_MATERIAL',
    });
    if (!requisitionNumber || !requisitionPosition) errors.push('REQUISITION_IDENTITY_MISSING');
    if (requisitionNumber && requisitionPosition) externalKey = `PR:${requisitionNumber}:${requisitionPosition}`;
  } else if (profileId === 'open_purchase_orders_v1') {
    const purchaseOrderNumber = asDocument(pick(map, 'Documento compras'));
    const purchaseOrderPosition = asPosition(pick(map, 'Posición'));
    const requisitionNumber = asDocument(pick(map, 'Solicitud de pedido'));
    const requisitionPosition = asPosition(pick(map, 'Pos.solicitud pedido'));
    fields = compact({
      purchaseOrderNumber,
      purchaseOrderPosition,
      documentDate: asIsoDate(pick(map, 'Fecha documento')),
      supplierOrSupplyingPlant: asText(pick(map, 'Proveedor/Centro suministrador')),
      materialCode: asDocument(pick(map, 'Material')),
      description: asText(pick(map, 'Texto breve')),
      orderUom: asText(pick(map, 'Unidad medida pedido')),
      orderedQuantity: asNumber(pick(map, 'Cantidad de pedido')),
      openQuantity: asNumber(pick(map, 'Por entregar (cantidad)')),
      requisitionNumber,
      requisitionPosition,
      deliveryDate: asIsoDate(pick(map, 'Fecha de entrega')),
      plant: asText(pick(map, 'Centro')),
      materialGroup: asText(pick(map, 'Grupo de artículos')),
      purchasingGroup: asText(pick(map, 'Grupo de compras')),
      netPrice: asNumber(pick(map, 'Precio neto')),
      currency: asText(pick(map, 'Moneda')),
      accountAssignmentType: asText(pick(map, 'Tipo de imputación')),
      requester: asText(pick(map, 'Solicitante')),
    });
    if (!purchaseOrderNumber || !purchaseOrderPosition) errors.push('PURCHASE_ORDER_IDENTITY_MISSING');
    if (purchaseOrderNumber && purchaseOrderPosition) externalKey = `PO:${purchaseOrderNumber}:${purchaseOrderPosition}`;
  } else if (profileId === 'material_movements_v1') {
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
  } else if (profileId === 'project_actual_costs_v1') {
    const companyCode = asDocument(pick(map, 'Sociedad'));
    const fiscalYear = asDocument(pick(map, 'Ejercicio'));
    const accountingDocument = asDocument(pick(map, 'Número de documento'));
    const accountingDocumentItem = asAccountingDocumentItem(pickFirst(map, [
      'Posición documento', 'Posición doc.contable', 'Pos.documento', 'Posición de documento', 'Partida',
    ]));
    fields = compact({
      projectDefinition: asText(pick(map, 'Definición del proyecto')),
      wbsElement: asText(pick(map, 'Elemento PEP')),
      costElementName: asText(pick(map, 'Denom.clase de coste')),
      objectName: asText(pick(map, 'Denominación del objeto')),
      objectCode: asDocument(pick(map, 'Objeto')),
      costElement: asDocument(pick(map, 'Clase de coste')),
      costClassDescription: asText(pick(map, 'Descrip.clases coste')),
      valueType: asDocument(pick(map, 'Tipo de valor')),
      documentClass: asText(pick(map, 'Clase de documento')),
      plant: asText(pick(map, 'Centro')),
      companyCurrencyValue: asNumber(pick(map, 'Val/Mon.so.CO')),
      companyCurrency: asText(pick(map, 'Moneda sociedad CO')),
      objectCurrencyValue: asNumber(pick(map, 'Valor/Moneda objeto')),
      objectCurrency: asText(pick(map, 'Moneda del objeto')),
      user: asText(pick(map, 'Usuario')),
      documentDate: asIsoDate(pick(map, 'Fecha de documento')),
      postingDate: asIsoDate(pick(map, 'Fe.contabilización')),
      entryDate: asIsoDate(pick(map, 'Fecha entrada')),
      companyCode,
      fiscalYear,
      accountingDocument,
      accountingDocumentItem,
      offsetAccount: asDocument(pick(map, 'Cta.contrapartida')),
      documentHeaderText: asText(pick(map, 'Texto de cabecera de documento')),
      materialCode: asDocument(pick(map, 'Material')),
      materialDescription: asText(pick(map, 'Texto breve de material')),
      quantity: asNumber(pick(map, 'Cantidad total reg.')),
      referenceDocument: asDocument(pick(map, 'Nº docum.refer.')),
      operation: asText(pick(map, 'Operación')),
      originalOperation: asText(pick(map, 'Operación original')),
      referenceOperation: asText(pick(map, 'Operación referencia')),
      uom: asText(pick(map, 'Unidad de medida')),
      debitCreditIndicator: asText(pick(map, 'Indic.cargo/abono')),
    });
    if (!asText(pick(map, 'Elemento PEP')) || !accountingDocument) {
      errors.push('ACTUAL_COST_CORE_FIELDS_MISSING');
    }
    if (companyCode && fiscalYear && accountingDocument && accountingDocumentItem) {
      externalKey = `FI:${companyCode}:${fiscalYear}:${accountingDocument}:${accountingDocumentItem}`;
    } else {
      warnings.push('ACCOUNTING_LINE_POSITION_NOT_AVAILABLE');
    }
  } else {
    const referenceDocument = asDocument(pick(map, 'Nº docum.refer.'));
    const referencePosition = asPosition(pick(map, 'Pos.referencia'));
    const referenceType = asText(pick(map, 'Tipo de documento de referencia'));
    fields = compact({
      costElement: asDocument(pick(map, 'Clase de coste')),
      costElementName: asText(pick(map, 'Denom.clase de coste')),
      wbsElement: asText(pick(map, 'Elemento PEP')),
      objectName: asText(pick(map, 'Denominación del objeto')),
      referenceDocument,
      referencePosition,
      referenceDocumentType: referenceType,
      companyCurrencyValue: asNumber(pick(map, 'Val/Mon.so.CO')),
      reportCurrency: asText(pick(map, 'Moneda del informe')),
      objectCurrencyValue: asNumber(pick(map, 'Valor/Moneda objeto')),
      user: asText(pick(map, 'Usuario')),
      materialCode: asDocument(pick(map, 'Material')),
      materialDescription: asText(pick(map, 'Texto breve de material')),
      postingDate: asIsoDate(pick(map, 'Fecha de cargo')),
      costClassDescription: asText(pick(map, 'Descrip.clases coste')),
      uom: asText(pick(map, 'Unidad de medida')),
      quantity: asNumber(pick(map, 'Cantidad total')),
      projectDefinition: asText(pick(map, 'Definición del proyecto')),
      fiscalYear: asDocument(pick(map, 'Ejercicio')),
      documentDate: asIsoDate(pick(map, 'Fecha de documento')),
      materialGroup: asText(pick(map, 'Grupo de artículos')),
      debitCreditIndicator: asText(pick(map, 'Indic.cargo/abono')),
      deletionIndicator: asText(pick(map, 'Indicador de borrado')),
      ledger: asText(pick(map, 'Ledger')),
      operation: asText(pick(map, 'Operación')),
      period: asDocument(pick(map, 'Período')),
      supplier: asText(pick(map, 'Proveedor')),
      companyCode: asText(pick(map, 'Sociedad')),
      valueType: asDocument(pick(map, 'Tipo de valor')),
    });
    if (!referenceDocument || !asText(pick(map, 'Elemento PEP'))) errors.push('COMMITMENT_CORE_FIELDS_MISSING');
    if (profileId === 'commitments_legacy_v1') {
      warnings.push('REFERENCE_POSITION_NOT_AVAILABLE');
    } else if (referenceDocument && referencePosition) {
      const normalizedType = referenceType?.toLowerCase() ?? '';
      const prefix = normalizedType.includes('sol') ? 'PR' : normalizedType.includes('ped') ? 'PO' : 'REF';
      externalKey = `${prefix}:${referenceDocument}:${referencePosition}`;
    }
  }

  return { fields, externalKey, warnings: [...new Set(warnings)], errors: [...new Set(errors)] };
}

export const sapSourceProfiles = profiles.map((profile) => ({
  profileId: profile.id,
  sourceKey: profile.sourceKey,
  displayName: profile.displayName,
  requiredHeaders: [...profile.required],
  optionalHeaders: [...profile.optional],
}));
