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
