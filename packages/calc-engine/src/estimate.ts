import type { MaterialLine, WorkLine, EstimateSummary } from './types';

const DEFAULT_RESERVE_PERCENT = 5;

export function lineTotal(quantity: number, price: number): number {
  return round2(quantity * price);
}

export function sumMaterials(lines: MaterialLine[]): number {
  return round2(lines.reduce((s, l) => s + lineTotal(l.quantity, l.unitPrice), 0));
}

export function sumWorks(lines: WorkLine[]): number {
  return round2(lines.reduce((s, l) => s + lineTotal(l.quantity, l.ratePerUnit), 0));
}

export function calcEstimateSummary(
  materials: MaterialLine[],
  works: WorkLine[],
  reservePercent = DEFAULT_RESERVE_PERCENT,
): EstimateSummary {
  const materialsTotal = sumMaterials(materials);
  const worksTotal = sumWorks(works);
  const subtotal = round2(materialsTotal + worksTotal);
  const reserveAmount = round2(subtotal * (reservePercent / 100));
  const grandTotal = round2(subtotal + reserveAmount);
  return {
    materialsTotal,
    worksTotal,
    subtotal,
    reservePercent,
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
  return round2(baseQty * materialWasteFactor(kind));
}

/** Рулонов обоев: запас 15% на подгонку рисунка, округление вверх (не round). Эталоны: reference-cases.json */
export function wallpaperRolls(wallSqM: number, rollSqM = 5): number {
  if (!Number.isFinite(wallSqM) || wallSqM < 0) throw new RangeError('wallSqM must be a non-negative finite number');
  if (!Number.isFinite(rollSqM) || rollSqM <= 0) throw new RangeError('rollSqM must be positive');
  if (wallSqM === 0) return 0;
  return Math.ceil(round2(wallSqM * materialWasteFactor('wallpaper')) / rollSqM - 1e-9);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
