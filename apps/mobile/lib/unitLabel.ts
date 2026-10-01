/** Единицы измерения для экрана: серверные коды (`m2`, `pcs`) — по-русски. Незнакомое — как есть. */
const UNIT_RU: Record<string, string> = {
  m2: 'м²',
  m3: 'м³',
  m: 'м',
  pcs: 'шт',
  pc: 'шт',
  kg: 'кг',
  l: 'л',
  t: 'т',
  point: 'точка',
  set: 'компл.',
};

export function unitRu(unit: string | null | undefined): string {
  if (!unit) return '';
  return UNIT_RU[unit.trim().toLowerCase()] ?? unit;
}
