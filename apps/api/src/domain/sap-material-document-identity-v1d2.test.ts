import { describe, expect, it } from 'vitest';
import { detectSapSource, normalizeSapRow } from './sap-source-detection-v1.js';

describe('SAP material document identity V1-D2', () => {
  it('keeps the legacy movement structure detectable without MATDOC columns', () => {
    const detection = detectSapSource([
      'Centro', 'Almacén', 'Cantidad', 'Clase de movimiento', 'Fe.contabilización',
      'Nº reserva', 'Nº pos.reserva traslado', 'Material', 'Pedido', 'Posición',
    ]);
    expect(detection?.sourceKey).toBe('SAP_MATERIAL_MOVEMENTS');
    expect(detection?.profileId).toBe('material_movements_v1');
  });

  it('builds deterministic MATDOC identity when document, fiscal year and item are present', () => {
    const normalized = normalizeSapRow('material_movements_v1', [
      { header: 'Centro', value: '1000' },
      { header: 'Almacén', value: '0001' },
      { header: 'Cantidad', value: 8 },
      { header: 'Clase de movimiento', value: 101 },
      { header: 'Fe.contabilización', value: '29.08.2026' },
      { header: 'Nº reserva', value: 0 },
      { header: 'Nº pos.reserva traslado', value: 0 },
      { header: 'Material', value: 13042034 },
      { header: 'Pedido', value: 4500035208 },
      { header: 'Posición', value: 180 },
      { header: 'Documento material', value: 5001234567 },
      { header: 'Ejercicio', value: 2026 },
      { header: 'Posición doc.material', value: 1 },
    ]);

    expect(normalized.externalKey).toBe('MATDOC:2026:5001234567:0001');
    expect(normalized.fields.materialDocumentNumber).toBe('5001234567');
    expect(normalized.fields.materialDocumentYear).toBe('2026');
    expect(normalized.fields.materialDocumentItem).toBe('0001');
    expect(normalized.warnings).not.toContain('MATERIAL_DOCUMENT_IDENTITY_NOT_AVAILABLE');
  });

  it('does not invent MATDOC identity when the item is missing', () => {
    const normalized = normalizeSapRow('material_movements_v1', [
      { header: 'Centro', value: '1000' },
      { header: 'Almacén', value: '0001' },
      { header: 'Cantidad', value: 8 },
      { header: 'Clase de movimiento', value: 101 },
      { header: 'Fe.contabilización', value: '29.08.2026' },
      { header: 'Nº reserva', value: 0 },
      { header: 'Nº pos.reserva traslado', value: 0 },
      { header: 'Documento material', value: 5001234567 },
      { header: 'Ejercicio', value: 2026 },
    ]);
    expect(normalized.externalKey).toBeNull();
    expect(normalized.warnings).toContain('MATERIAL_DOCUMENT_IDENTITY_NOT_AVAILABLE');
  });
});
