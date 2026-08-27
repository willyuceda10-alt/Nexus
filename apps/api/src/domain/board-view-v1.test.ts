import { describe, expect, it } from 'vitest';
import {
  WorkBoardValidationError,
  normalizeBoardKeyV1,
  validateBoardColumnV1,
  validateViewConfigV1,
} from './board-view-v1.js';

describe('Work OS Board + View Engine V1', () => {
  it('normalizes labels into stable safe keys', () => {
    expect(normalizeBoardKeyV1('  Fecha de Entrega  ')).toBe('fecha_de_entrega');
    expect(normalizeBoardKeyV1('Área / Fundo')).toBe('area_fundo');
  });

  it('accepts valid core field mappings', () => {
    expect(() => validateBoardColumnV1({ source: 'CORE', fieldKey: 'status', dataType: 'STATUS' })).not.toThrow();
    expect(() => validateBoardColumnV1({ source: 'CORE', fieldKey: 'dueDate', dataType: 'DATE' })).not.toThrow();
  });

  it('rejects incompatible core field mappings', () => {
    expect(() => validateBoardColumnV1({ source: 'CORE', fieldKey: 'status', dataType: 'NUMBER' }))
      .toThrow(WorkBoardValidationError);
  });

  it('blocks prototype-pollution and reserved custom keys', () => {
    expect(() => validateBoardColumnV1({ source: 'CUSTOM', fieldKey: '__proto__', dataType: 'TEXT' }))
      .toThrow(WorkBoardValidationError);
    expect(() => validateBoardColumnV1({ source: 'CUSTOM', fieldKey: 'title', dataType: 'TEXT' }))
      .toThrow(WorkBoardValidationError);
  });

  it('requires the structural field needed by each view type', () => {
    expect(() => validateViewConfigV1('KANBAN', { kanbanColumnKey: 'status' })).not.toThrow();
    expect(() => validateViewConfigV1('KANBAN', {})).toThrow(WorkBoardValidationError);
    expect(() => validateViewConfigV1('GANTT', { startFieldKey: 'startDate', endFieldKey: 'dueDate' })).not.toThrow();
  });

  it('accepts per-view hidden columns and column order', () => {
    expect(() => validateViewConfigV1('TABLE', {
      hiddenColumnKeys: ['priority', 'description'],
      columnOrder: ['title', 'status', 'assigneeId', 'dueDate'],
    })).not.toThrow();
    expect(() => validateViewConfigV1('TABLE', { columnOrder: 'title,status' }))
      .toThrow(WorkBoardValidationError);
  });
});
