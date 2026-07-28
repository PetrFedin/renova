/** Имена тестовых/E2E проектов — общий SoT для picker и active project. */

export function isJunkProjectName(name?: string | null): boolean {
  const n = (name ?? '').trim();
  if (!n) return false;
  // Empty-state template «Студия» / «Studio» без адреса — демо-мусор в picker (не «Студия 45м²»)
  if (/^(студия|studio)$/i.test(n)) return true;
  return /wizard\s*test|\be2e\b|gate\s*test|walkthrough|(^|\s)test(\s|$)/i.test(n);
}

/** Список без junk — для picker / portfolio UI (если всё junk — оставляем как есть). */
export function filterOutJunkProjects<T extends { name?: string | null }>(projects: T[]): T[] {
  const clean = projects.filter((p) => !isJunkProjectName(p.name));
  return clean.length > 0 ? clean : projects;
}
