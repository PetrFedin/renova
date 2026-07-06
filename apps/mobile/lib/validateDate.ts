/** Простая проверка ISO-даты YYYY-MM-DD */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function normalizeIsoDateInput(value: string): string {
  return value.replace(/[^\d-]/g, '').slice(0, 10);
}
