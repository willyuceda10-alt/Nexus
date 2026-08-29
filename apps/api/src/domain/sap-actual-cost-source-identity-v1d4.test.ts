import { describe, expect, it } from 'vitest';
import { normalizeSapRow } from './sap-source-detection-v1.js';

describe('SAP DATA PEP source identity V1-D4', () => {
  it('emits exact FI external identity when company, fiscal year and line item are present', () => {
    const result = normalizeSapRow('project_actual_costs_v1', [
      { header: 'Elemento PEP', value: 'CSF-25-SAG-TR-I-RASN-012' },
      { header: 'Número de documento', value: '5000001234' },
      { header: 'Sociedad', value: '1000' },
      { header: 'Ejercicio', value: 2026 },
      { header: 'Posición documento', value: 1 },
      { header: 'Fe.contabilización', value: '29.08.2026' },
      { header: 'Val/Mon.so.CO', value: 100 },
      { header: 'Moneda sociedad CO', value: 'USD' },
    ]);
    expect(result.externalKey).toBe('FI:1000:2026:5000001234:001');
    expect(result.fields.accountingDocumentItem).toBe('001');
    expect(result.warnings).not.toContain('ACCOUNTING_LINE_POSITION_NOT_AVAILABLE');
  });

  it('keeps legacy DATA PEP without a line position non-exact for aggregate projection', () => {
    const result = normalizeSapRow('project_actual_costs_v1', [
      { header: 'Elemento PEP', value: 'CSF-25-SAG-TR-I-RASN-012' },
      { header: 'Número de documento', value: '5000001234' },
      { header: 'Fe.contabilización', value: '29.08.2026' },
      { header: 'Val/Mon.so.CO', value: 100 },
      { header: 'Moneda sociedad CO', value: 'USD' },
    ]);
    expect(result.externalKey).toBeNull();
    expect(result.warnings).toContain('ACCOUNTING_LINE_POSITION_NOT_AVAILABLE');
  });
});
