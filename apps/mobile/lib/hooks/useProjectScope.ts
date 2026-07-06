import { useRenova } from '@/lib/context/RenovaContext';

export type ProjectScopeStatus = 'loading' | 'ready' | 'empty' | 'pick' | 'no-user';

export function useProjectScope(): {
  status: ProjectScopeStatus;
  activeProject: NonNullable<ReturnType<typeof useRenova>['activeProject']> | null;
  user: NonNullable<ReturnType<typeof useRenova>['user']> | null;
} {
  const { user, activeProject, projects, loading, projectResolving } = useRenova();

  if (!user) return { status: 'no-user', activeProject: null, user: null };
  // Объект уже выбран — не прячем hub за спиннером при фоновом loadProject
  if (activeProject) return { status: 'ready', activeProject, user };
  if (loading || projectResolving) return { status: 'loading', activeProject: null, user };
  if (!projects.length) return { status: 'empty', activeProject: null, user };
  return { status: 'pick', activeProject: null, user };
}
