/** JSON field-level diff для offline merge */
export function fieldDiff(local: string, server?: string): { field: string; local: string; server: string }[] {
  let a: Record<string, unknown> = {};
  let b: Record<string, unknown> = {};
  try { a = JSON.parse(local); } catch {}
  try { b = server ? JSON.parse(server) : {}; } catch {}
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: { field: string; local: string; server: string }[] = [];
  keys.forEach(k => {
    const lv = JSON.stringify(a[k] ?? '—');
    const sv = JSON.stringify(b[k] ?? '—');
    if (lv !== sv) out.push({ field: k, local: lv, server: sv });
  });
  return out;
}

/**
 * INB-07: слияние по полям. Поле берётся с «сервера» только если серверная версия известна и поле в ней есть;
 * иначе остаётся локальное значение — выбор «Сервер» не должен стирать поле из тела запроса.
 */
export function mergeFieldChoices(
  local: string,
  server: string | undefined,
  pick: Record<string, 'local' | 'server'>,
): string {
  let obj: Record<string, unknown> = {};
  let srv: Record<string, unknown> | null = null;
  try { obj = JSON.parse(local); } catch {}
  try { srv = server ? JSON.parse(server) : null; } catch { srv = null; }
  for (const d of fieldDiff(local, server)) {
    if ((pick[d.field] || 'local') !== 'server' || !srv) continue;
    if (Object.prototype.hasOwnProperty.call(srv, d.field)) obj[d.field] = srv[d.field];
    else delete obj[d.field];
  }
  return JSON.stringify(obj);
}
