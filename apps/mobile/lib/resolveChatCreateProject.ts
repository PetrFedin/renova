/** Объект для нового чата — из фильтра списка, без дубля в UI */
import type { ChatProjectFilter } from '@/lib/chatProjectFilter';

type Project = { id: string; name: string };

export function resolveChatCreateProject(
  filter: ChatProjectFilter,
  projects: Project[],
  activeProjectId?: string | null,
): {
  projectId: string | null;
  projectName: string;
  /** Объект уже задан фильтром — в форме только подпись */
  locked: boolean;
  /** Доступные объекты в sheet (если не locked) */
  selectableIds: string[];
} {
  if (!projects.length) {
    return { projectId: null, projectName: '', locked: true, selectableIds: [] };
  }

  const nameOf = (id: string) => projects.find((p) => p.id === id)?.name ?? 'Объект';

  if (filter.projectIds?.length === 1) {
    const id = filter.projectIds[0];
    return { projectId: id, projectName: nameOf(id), locked: true, selectableIds: [id] };
  }

  if (filter.projectIds === null && projects.length === 1) {
    return {
      projectId: projects[0].id,
      projectName: projects[0].name,
      locked: true,
      selectableIds: [projects[0].id],
    };
  }

  const pool = filter.projectIds ?? projects.map((p) => p.id);
  const defaultId =
    (activeProjectId && pool.includes(activeProjectId) ? activeProjectId : null)
    ?? pool[0]
    ?? projects[0]?.id
    ?? null;

  return {
    projectId: defaultId,
    projectName: defaultId ? nameOf(defaultId) : '',
    locked: pool.length <= 1,
    selectableIds: pool,
  };
}
