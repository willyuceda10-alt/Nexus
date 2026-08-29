import { describe, expect, it } from 'vitest';
import { detectSapSource, normalizeSapRow } from './sap-source-detection-v1.js';

const enrichedCommitmentHeaders = [
  'Clase de coste', 'Denom.clase de coste', 'Elemento PEP', 'Denominación del objeto',
  'Nº docum.refer.', 'Val/Mon.so.CO', 'Moneda del informe', 'Valor/Moneda objeto', 'Usuario',
  'Material', 'Texto breve de material', 'Fecha de cargo', 'Descrip.clases coste', 'Unidad de medida',
  'Cantidad total', 'Denominación', 'Pos.referencia', 'Posición fecha', 'Área funcional',
  'Cantidad/Plan', 'Clase de objeto', 'Clase doc. referencia', 'Definición del proyecto', 'Ejercicio',
  'Fecha de documento', 'Grupo de artículos', 'Indic.cargo/abono', 'Indicador de borrado', 'Ledger',
  'Moneda del objeto', 'Moneda transacción', 'Número de imputación', 'Objeto', 'Operación', 'Período',
  'Proveedor', 'Sociedad', 'Tipo de documento de referencia', 'Tipo de valor', 'Versión',
];

const legacyCommitmentHeaders = [
  'Clase de coste', 'Denom.clase de coste', 'Elemento PEP', 'Denominación del objeto',
  'Nº docum.refer.', 'Val/Mon.so.CO', 'Moneda del informe', 'Valor/Moneda objeto', 'Usuario',
  'Material', 'Texto breve de material', 'Fecha de cargo', 'Descrip.clases coste', 'Unidad de medida',
  'Cantidad total', 'Denominación',
];

const projectProcurementHeaders = [
  'Solicitud de pedido', 'Creado por', 'Fecha de solicitud', 'Fecha de liberación',
  'Pos.solicitud pedido', 'Status tratamiento', 'Grupo de compras', 'Grupo de artículos',
  'Material', 'Texto breve', 'Cantidad solicitada', 'Unidad de medida', 'Valor total', 'Moneda',
  'Centro', 'Solicitante', 'Tipo de imputación', 'Pedido', 'Posición de pedido',
  'Entrada mercancías', 'Nº reserva', 'Indicador de bloqueo',
];

const openOrdersHeaders = [
  'Documento compras', 'Fecha documento', 'Proveedor/Centro suministrador', 'Material', 'Texto breve',
  'Unidad medida pedido', 'Cantidad de pedido', 'Por entregar (cantidad)', 'Solicitud de pedido',
  'Fecha de entrega', 'Centro', 'Grupo de artículos', 'Grupo de compras', 'Pos.solicitud pedido',
  'Precio neto', 'Moneda', 'Tipo de imputación', 'Solicitante', 'Posición',
];

const movementHeaders = [
  'Centro', 'Almacén', 'Material', 'Texto breve de material', 'Unidad medida base', 'Cantidad',
  'Clase de movimiento', 'Fecha de entrada', 'Fe.contabilización', 'Nº reserva',
  'Nº pos.reserva traslado', 'Referencia', 'Texto cab.documento', 'Nombre del usuario', 'Pedido',
  'Posición', 'Elemento PEP',
];

const actualCostHeaders = [
  'Definición del proyecto', 'Elemento PEP', 'Denom.clase de coste', 'Denominación del objeto',
  'Objeto', 'Clase de coste', 'Descrip.clases coste', 'Tipo de valor', 'Clase de documento', 'Centro',
  'Val/Mon.so.CO', 'Moneda sociedad CO', 'Valor/Moneda objeto', 'Moneda del objeto', 'Usuario',
  'A período', 'De período', 'Fecha de documento', 'Fe.contabilización', 'Fecha entrada',
  'Número de documento', 'Cta.contrapartida', 'Denom.cuenta contrapartida',
  'Texto de cabecera de documento', 'Material', 'Texto breve de material', 'Cantidad total reg.',
  'Nº docum.refer.', 'Operación', 'Operación original', 'Operación referencia',
  'Objeto del interlocutor', 'Unidad de medida', 'Indic.cargo/abono', 'Denominación',
  'Tipo de cargo', 'Clase de objeto',
];

describe('SAP structure-based source detection v1', () => {
  it.each([
    [enrichedCommitmentHeaders, 'SAP_PROCUREMENT_COMMITMENTS', 'commitments_enriched_v1'],
    [legacyCommitmentHeaders, 'SAP_PROCUREMENT_COMMITMENTS', 'commitments_legacy_v1'],
    [projectProcurementHeaders, 'SAP_PROJECT_PROCUREMENT', 'project_procurement_v1'],
    [openOrdersHeaders, 'SAP_OPEN_PURCHASE_ORDERS', 'open_purchase_orders_v1'],
    [movementHeaders, 'SAP_MATERIAL_MOVEMENTS', 'material_movements_v1'],
    [actualCostHeaders, 'SAP_PROJECT_ACTUAL_COSTS', 'project_actual_costs_v1'],
  ] as const)('detects source from headers instead of filename', (headers, sourceKey, profileId) => {
    const detected = detectSapSource([...headers]);
    expect(detected?.sourceKey).toBe(sourceKey);
    expect(detected?.profileId).toBe(profileId);
    expect(detected?.confidence).toBeGreaterThanOrEqual(0.82);
  });

  it('does not treat goods-receipt eligibility as proof that an item was received', () => {
    const result = normalizeSapRow('project_procurement_v1', [
      { header: 'Solicitud de pedido', value: '1000001763' },
      { header: 'Pos.solicitud pedido', value: 4420 },
      { header: 'Pedido', value: null },
      { header: 'Posición de pedido', value: null },
      { header: 'Entrada mercancías', value: 'Sí' },
      { header: 'Material', value: null },
      { header: 'Unidad de medida', value: 'SRV' },
    ]);
    expect(result.externalKey).toBe('PR:1000001763:04420');
    expect(result.fields.goodsReceiptExpected).toBe(true);
    expect(result.fields.itemKind).toBe('SERVICE');
    expect(result.fields).not.toHaveProperty('received');
  });

  it('keeps movement identity unresolved when the material document line is absent', () => {
    const result = normalizeSapRow('material_movements_v1', [
      { header: 'Centro', value: 'CSMV' },
      { header: 'Almacén', value: 'MV01' },
      { header: 'Cantidad', value: -26 },
      { header: 'Clase de movimiento', value: 221 },
      { header: 'Fe.contabilización', value: 46175 },
      { header: 'Nº reserva', value: 1609505 },
      { header: 'Nº pos.reserva traslado', value: 1 },
    ]);
    expect(result.externalKey).toBeNull();
    expect(result.fields.movementSemantics).toBe('ISSUE');
    expect(result.warnings).toContain('MATERIAL_DOCUMENT_IDENTITY_NOT_AVAILABLE');
  });
});
