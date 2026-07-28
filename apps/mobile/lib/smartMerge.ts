/** Auto-resolve: identical body duplicates in offline queue */
export function dedupeQueue<T extends { id: string; path: string; body: string }>(jobs: T[]): T[] {
  const seen = new Map<string, string>();
  const keep: T[] = [];
  for (const j of jobs) {
    const k = `${j.path}:${j.body}`;
    if (seen.has(k)) continue;
    seen.set(k, j.id);
    keep.push(j);
  }
  return keep;
}
