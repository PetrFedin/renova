import type { MaterialLine, WorkLine, EstimateSummary } from './types';

const DEFAULT_RESERVE_PERCENT = 5;
const MAX_RESERVE_PERCENT = 100;

export function lineTotal(quantity: number, price: number): number {
  assertNonNegativeFinite(quantity, 'quantity');
  assertNonNegativeFinite(price, 'price');
  return round2(quantity * price);
}

export function sumMaterials(lines: MaterialLine[]): number {
  assertUniqueLineIds(lines, 'material');
  return sumRoundedLineTotals(lines, (line) => lineTotal(line.quantity, line.unitPrice));
}

export function sumWorks(lines: WorkLine[]): number {
  assertUniqueLineIds(lines, 'work');
  return sumRoundedLineTotals(lines, (line) => lineTotal(line.quantity, line.ratePerUnit));
}

export function calcEstimateSummary(
  materials: MaterialLine[],
  works: WorkLine[],
  reservePercent = DEFAULT_RESERVE_PERCENT,
): EstimateSummary {
  assertReservePercent(reservePercent);

  const materialsTotal = sumMaterials(materials);
  const worksTotal = sumWorks(works);
  const subtotal = round2(materialsTotal + worksTotal);
  const reserveAmount = round2(subtotal * (reservePercent / 100));
  const grandTotal = round2(subtotal + reserveAmount);

  return {
    materialsTotal,
    worksTotal,
    subtotal,
    reservePercent: round2(reservePercent),
    reserveAmount,
    grandTotal,
  };
}

/** Запас материала по типу работ */
export function materialWasteFactor(materialKind: 'tile' | 'wallpaper' | 'paint' | 'default'): number {
  switch (materialKind) {
    case 'tile':
      return 1.1;
    case 'wallpaper':
      return 1.15;
    case 'paint':
      return 1.05;
    default:
      return 1.08;
  }
}

/** Кол-во материала с запасом */
export function quantityWithWaste(baseQty: number, kind: 'tile' | 'wallpaper' | 'paint' | 'default'): number {
  assertNonNegativeFinite(baseQty, 'baseQty');
  return round2(baseQty * materialWasteFactor(kind));
}

function sumRoundedLineTotals<T>(lines: T[], getTotal: (line: T) => number): number {
  // Складываем уже округлённые суммы строк: итог совпадает с тем, что видит пользователь.
  return round2(lines.reduce((sum, line) => sum + getTotal(line), 0));
}

function assertUniqueLineIds(lines: Array<{ id: string }>, kind: 'material' | 'work'): void {
  const seen = new Set<string>();

  for (const line of lines) {
    if (!line.id.trim()) {
      throw new Error(`Estimate ${kind} line must have a non-empty id`);
    }
    if (seen.has(line.id)) {
      throw new Error(`Duplicate estimate ${kind} line id: ${line.id}`);
    }
    seen.add(line.id);
  }
}

function assertReservePercent(value: number): void {
  assertNonNegativeFinite(value, 'reservePercent');
  if (value > MAX_RESERVE_PERCENT) {
    throw new RangeError(`reservePercent must be between 0 and ${MAX_RESERVE_PERCENT}`);
  }
}

function assertNonNegativeFinite(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${field} must be a finite non-negative number`);
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
