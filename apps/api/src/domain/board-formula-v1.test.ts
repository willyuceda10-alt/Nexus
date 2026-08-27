import { describe, expect, it } from 'vitest';
import {
  BoardFormulaValidationError,
  evaluateBoardFormulaV1,
  validateBoardFormulaV1,
  type BoardFormulaExpressionV1,
} from './board-formula-v1.js';

describe('Board Formula V1', () => {
  it('evaluates deterministic arithmetic over fields and literals', () => {
    const expression: BoardFormulaExpressionV1 = {
      kind: 'BINARY', op: 'MULTIPLY',
      left: { kind: 'FIELD', fieldKey: 'quantity' },
      right: { kind: 'FIELD', fieldKey: 'unit_cost' },
    };
    validateBoardFormulaV1(expression, { allowedFieldKeys: new Set(['quantity', 'unit_cost']) });
    expect(evaluateBoardFormulaV1(expression, (key) => ({ quantity: 4, unit_cost: 12.5 })[key as 'quantity' | 'unit_cost'])).toBe(50);
  });

  it('returns null instead of infinity on division by zero', () => {
    const expression: BoardFormulaExpressionV1 = {
      kind: 'BINARY', op: 'DIVIDE',
      left: { kind: 'LITERAL', value: 100 },
      right: { kind: 'LITERAL', value: 0 },
    };
    expect(evaluateBoardFormulaV1(expression, () => null)).toBeNull();
  });

  it('rejects self references, unknown fields and unsafe paths', () => {
    expect(() => validateBoardFormulaV1(
      { kind: 'FIELD', fieldKey: 'total' },
      { formulaFieldKey: 'total', allowedFieldKeys: new Set(['total']) },
    )).toThrow(BoardFormulaValidationError);
    expect(() => validateBoardFormulaV1(
      { kind: 'FIELD', fieldKey: '__proto__' },
      { allowedFieldKeys: new Set(['__proto__']) },
    )).toThrow(BoardFormulaValidationError);
    expect(() => validateBoardFormulaV1(
      { kind: 'FIELD', fieldKey: 'missing' },
      { allowedFieldKeys: new Set(['quantity']) },
    )).toThrow(BoardFormulaValidationError);
  });
});
