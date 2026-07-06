/** Какой проект считать активным: сохранённый на устройстве или канонический demo */
import { pickPrimaryDemoProject } from './pickPrimaryDemoProject';

export function isJunkProjectName(name?: string | null): boolean {
  return /wizard|(^|\s)test(\s|$)/i.test(name ?? '');
}

export function resolveActiveProjectId(
  projects: { id: string; name?: string | null }[],
  savedProjectId: string | null | undefined,
): string | null {
  if (!projects.length) return null;
  if (savedProjectId) {
    const saved = projects.find((p) => p.id === savedProjectId);
    if (saved && !isJunkProjectName(saved.name)) return savedProjectId;
  }
  return pickPrimaryDemoProject(projects)?.id ?? projects[0].id;
}
