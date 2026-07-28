import type { FormulaDefinition } from './formula-engine';

/**
 * Версионируемый каталог инженерных формул Renova.
 * Формулы отделены от цен и нормативов: одна формула может использоваться
 * с разными региональными и временными наборами коэффициентов.
 */
export const CALC_FORMULAS = Object.freeze({
  paintLiters: {
    id: 'material.paint.liters',
    version: '1.0.0',
    unit: 'l',
    expression: {
      type: 'round',
      precision: 2,
      operand: {
        type: 'multiply',
        operands: [
          {
            type: 'divide',
            numerator: {
              type: 'multiply',
              operands: [
                { type: 'variable', name: 'wallSqM' },
                { type: 'variable', name: 'coats' },
              ],
            },
            denominator: { type: 'variable', name: 'coverage' },
          },
          { type: 'variable', name: 'wasteFactor' },
        ],
      },
    },
  },
  waterproofingArea: {
    id: 'work.waterproofing.area',
    version: '1.0.0',
    unit: 'm2',
    expression: {
      type: 'round',
      precision: 2,
      operand: {
        type: 'add',
        operands: [
          { type: 'variable', name: 'wallSqM' },
          { type: 'variable', name: 'floorSqM' },
        ],
      },
    },
  },
  waterproofingKg: {
    id: 'material.waterproofing.kg',
    version: '1.0.0',
    unit: 'kg',
    expression: {
      type: 'round',
      precision: 2,
      operand: {
        type: 'multiply',
        operands: [
          { type: 'variable', name: 'quantity' },
          { type: 'variable', name: 'consumption' },
        ],
      },
    },
  },
  backsplashArea: {
    id: 'work.kitchen-backsplash.area',
    version: '1.0.0',
    unit: 'm2',
    expression: {
      type: 'round',
      precision: 2,
      operand: {
        type: 'multiply',
        operands: [
          { type: 'variable', name: 'wallSqM' },
          { type: 'variable', name: 'share' },
        ],
      },
    },
  },
  plasterKg: {
    id: 'material.plaster.kg',
    version: '1.0.0',
    unit: 'kg',
    expression: {
      type: 'round',
      precision: 2,
      operand: {
        type: 'multiply',
        operands: [
          { type: 'variable', name: 'wallSqM' },
          { type: 'variable', name: 'consumption' },
        ],
      },
    },
  },
} satisfies Record<string, FormulaDefinition>);

export type CalcFormulaKey = keyof typeof CALC_FORMULAS;
