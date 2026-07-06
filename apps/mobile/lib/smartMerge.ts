/** Auto-resolve: identical body duplicates in offline queue */
export function dedupeQueue(jobs: { id: string; path: string; body: string }[]) {
  const seen = new Map<string, string>();
  const keep: typeof jobs = [];
  for (const j of jobs) {
    const k = `${j.path}:${j.body}`;
    if (seen.has(k)) continue;
    seen.set(k, j.id);
    keep.push(j);
  }
  return keep;
}
