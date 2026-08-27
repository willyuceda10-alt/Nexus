export type BoardFormulaOperandV1 =
  | { kind: 'FIELD'; fieldKey: string }
  | { kind: 'LITERAL'; value: number };

export type BoardFormulaExpressionV1 =
  | BoardFormulaOperandV1
  | {
      kind: 'BINARY';
      op: 'ADD' | 'SUBTRACT' | 'MULTIPLY' | 'DIVIDE' | 'MIN' | 'MAX';
      left: BoardFormulaExpressionV1;
      right: BoardFormulaExpressionV1;
    };

export class BoardFormulaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoardFormulaValidationError';
  }
}

const SAFE_FIELD = /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/;

export function validateBoardFormulaV1(
  expression: BoardFormulaExpressionV1,
  options: { formulaFieldKey?: string; allowedFieldKeys?: Set<string>; maxDepth?: number; maxNodes?: number } = {},
): void {
  const maxDepth = options.maxDepth ?? 8;
  const maxNodes = options.maxNodes ?? 32;
  let nodes = 0;

  const walk = (node: BoardFormulaExpressionV1, depth: number): void => {
    nodes += 1;
    if (nodes > maxNodes) throw new BoardFormulaValidationError(`Formula exceeds ${maxNodes} nodes.`);
    if (depth > maxDepth) throw new BoardFormulaValidationError(`Formula exceeds depth ${maxDepth}.`);

    if (node.kind === 'LITERAL') {
      if (!Number.isFinite(node.value)) throw new BoardFormulaValidationError('Formula literal must be finite.');
      return;
    }

    if (node.kind === 'FIELD') {
      if (!SAFE_FIELD.test(node.fieldKey)) throw new BoardFormulaValidationError(`Unsafe formula field: ${node.fieldKey}`);
      if (options.formulaFieldKey && node.fieldKey === options.formulaFieldKey) {
        throw new BoardFormulaValidationError('A formula cannot reference itself.');
      }
      if (options.allowedFieldKeys && !options.allowedFieldKeys.has(node.fieldKey)) {
        throw new BoardFormulaValidationError(`Formula field is not numeric or does not exist: ${node.fieldKey}`);
      }
      return;
    }

    if (!['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX'].includes(node.op)) {
      throw new BoardFormulaValidationError(`Unsupported formula operator: ${String(node.op)}`);
    }
    walk(node.left, depth + 1);
    walk(node.right, depth + 1);
  };

  walk(expression, 1);
}

function numeric(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function evaluateBoardFormulaV1(
  expression: BoardFormulaExpressionV1,
  resolveField: (fieldKey: string) => unknown,
): number | null {
  if (expression.kind === 'LITERAL') return expression.value;
  if (expression.kind === 'FIELD') return numeric(resolveField(expression.fieldKey));

  const left = evaluateBoardFormulaV1(expression.left, resolveField);
  const right = evaluateBoardFormulaV1(expression.right, resolveField);
  if (left === null || right === null) return null;

  switch (expression.op) {
    case 'ADD': return left + right;
    case 'SUBTRACT': return left - right;
    case 'MULTIPLY': return left * right;
    case 'DIVIDE': return right === 0 ? null : left / right;
    case 'MIN': return Math.min(left, right);
    case 'MAX': return Math.max(left, right);
  }
}

export function formatBoardFormulaValueV1(
  value: number | null,
  config: { format?: 'NUMBER' | 'CURRENCY' | 'PERCENT'; decimals?: number; currency?: string } = {},
): number | null {
  if (value === null) return null;
  const decimals = Math.max(0, Math.min(4, config.decimals ?? 2));
  const rounded = Number(value.toFixed(decimals));
  return Number.isFinite(rounded) ? rounded : null;
}
