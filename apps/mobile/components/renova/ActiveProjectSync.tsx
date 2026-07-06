/** Подхват сохранённого объекта при переходе между разделами OS */
import { useEffect } from 'react';
import { usePathname } from 'expo-router';
import { useRenova } from '@/lib/context/RenovaContext';

export function ActiveProjectSync() {
  const pathname = usePathname();
  const { user, activeProject, projects, loading, ensureActiveProject } = useRenova();

  useEffect(() => {
    if (loading || !user || activeProject || !projects.length) return;
    ensureActiveProject().catch(() => {});
  }, [loading, user?.id, activeProject?.id, projects.length, pathname, ensureActiveProject]);

  return null;
}
