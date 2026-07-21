/** Подхват сохранённого объекта при переходе между разделами OS */
import { useEffect } from 'react';
import { usePathname } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRenova } from '@/lib/context/RenovaContext';
import { SESSION_KEYS } from '@/constants/sessionKeys';
import { reportCatch } from '@/lib/reportError';

export function ActiveProjectSync() {
  const pathname = usePathname();
  const { user, activeProject, projects, loading, ensureActiveProject } = useRenova();

  useEffect(() => {
    if (loading || !user || activeProject || !projects.length) return;
    if (pathname.includes('/onboarding/')) return;
    AsyncStorage.getItem(SESSION_KEYS.pendingProjectPick).then((pending) => {
      if (pending === '1') return;
      ensureActiveProject().catch(reportCatch('components.renova.ActiveProjectSync.1'));
    });
  }, [loading, user?.id, activeProject?.id, projects.length, pathname, ensureActiveProject]);

  return null;
}
