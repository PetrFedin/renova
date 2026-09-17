export type FormulaVariableName =
  | 'floorSqM'
  | 'wallSqM'
  | 'perimeterM'
  | 'volumeCuM'
  | 'coats'
  | 'coverage'
  | 'consumption'
  | 'wasteFactor'
  | 'share'
  | 'quantity';

export type FormulaNode =
  | { type: 'constant'; value: number }
  | { type: 'variable'; name: FormulaVariableName }
  | { type: 'add'; operands: readonly FormulaNode[] }
  | { type: 'multiply'; operands: readonly FormulaNode[] }
  | { type: 'divide'; numerator: FormulaNode; denominator: FormulaNode }
  | { type: 'max'; operands: readonly FormulaNode[] }
  | { type: 'min'; operands: readonly FormulaNode[] }
  | { type: 'round'; operand: FormulaNode; precision: number };

export type FormulaContext = Partial<Record<FormulaVariableName, number>>;

export interface FormulaDefinition {
  id: string;
  version: string;
  unit: string;
  expression: FormulaNode;
}

export interface FormulaResult {
  formulaId: string;
  formulaVersion: string;
  unit: string;
  value: number;
}

/**
 * Детерминированно вычисляет формулу без eval и исполнения произвольного кода.
 * Любой отсутствующий, отрицательный или нечисловой параметр приводит к ошибке,
 * чтобы смета не формировалась из повреждённых исходных данных.
 */
export function evaluateFormula(
  formula: FormulaDefinition,
  context: FormulaContext,
): FormulaResult {
  assertNonEmpty(formula.id, 'formula.id');
  assertNonEmpty(formula.version, 'formula.version');
  assertNonEmpty(formula.unit, 'formula.unit');

  const value = evaluateNode(formula.expression, context);
  assertFiniteNonNegative(value, `formula ${formula.id} result`);

  return {
    formulaId: formula.id,
    formulaVersion: formula.version,
    unit: formula.unit,
    value,
  };
}

function evaluateNode(node: FormulaNode, context: FormulaContext): number {
  switch (node.type) {
    case 'constant':
      assertFiniteNonNegative(node.value, 'constant');
      return node.value;

    case 'variable': {
      const value = context[node.name];
      if (value === undefined) {
        throw new Error(`Missing formula variable: ${node.name}`);
      }
      assertFiniteNonNegative(value, `variable ${node.name}`);
      return value;
    }

    case 'add':
      assertOperands(node.operands, 'add');
      return node.operands.reduce((sum, operand) => sum + evaluateNode(operand, context), 0);

    case 'multiply':
      assertOperands(node.operands, 'multiply');
      return node.operands.reduce(
        (product, operand) => product * evaluateNode(operand, context),
        1,
      );

    case 'divide': {
      const numerator = evaluateNode(node.numerator, context);
      const denominator = evaluateNode(node.denominator, context);
      if (denominator === 0) {
        throw new RangeError('Formula division by zero');
      }
      return numerator / denominator;
    }

    case 'max':
      assertOperands(node.operands, 'max');
      return Math.max(...node.operands.map((operand) => evaluateNode(operand, context)));

    case 'min':
      assertOperands(node.operands, 'min');
      return Math.min(...node.operands.map((operand) => evaluateNode(operand, context)));

    case 'round': {
      if (!Number.isInteger(node.precision) || node.precision < 0 || node.precision > 6) {
        throw new RangeError('Formula round precision must be an integer between 0 and 6');
      }
      const value = evaluateNode(node.operand, context);
      const factor = 10 ** node.precision;
      return Math.round((value + Number.EPSILON) * factor) / factor;
    }

    default:
      return assertNever(node);
  }
}

function assertOperands(operands: readonly FormulaNode[], operation: string): void {
  if (operands.length === 0) {
    throw new Error(`Formula ${operation} requires at least one operand`);
  }
}

function assertFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${field} must be a finite non-negative number`);
  }
}

function assertNonEmpty(value: string, field: string): void {
  if (!value.trim()) {
    throw new Error(`${field} must be non-empty`);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported formula node: ${JSON.stringify(value)}`);
}
