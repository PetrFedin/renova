/** Какой проект считать активным: сохранённый на устройстве или канонический demo */
import { pickPrimaryDemoProject } from './pickPrimaryDemoProject';
import { filterOutJunkProjects, isJunkProjectName } from './junkProjects';

export { isJunkProjectName, filterOutJunkProjects } from './junkProjects';

export function resolveActiveProjectId(
  projects: { id: string; name?: string | null }[],
  savedProjectId: string | null | undefined,
): string | null {
  if (!projects.length) return null;
  const usable = filterOutJunkProjects(projects);
  if (savedProjectId) {
    const saved = usable.find((p) => p.id === savedProjectId);
    if (saved) return savedProjectId;
  }
  return pickPrimaryDemoProject(usable)?.id ?? usable[0]?.id ?? null;
}
