/** Прямой переход в OS после онбординга — без лишних redirect */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, type Href } from 'expo-router';
import type { UserRole } from '@/lib/api';
import { tabsRoute, type OsTabRoute } from '@/constants/osSections';
import { SESSION_KEYS } from '@/constants/sessionKeys';
import { replaceOsNav } from '@/lib/pushOsNav';

export function osEntryRoute(role: UserRole): OsTabRoute {
  return tabsRoute(role === 'contractor' ? 'contractor' : 'customer', 'index');
}

/** Экран выбора объекта после входа */
export function projectPickRoute(): string {
  return '/onboarding/project';
}

/** @deprecated Используйте osEntryRoute + replaceOsNav(route) */
export function osEntryHref(role: UserRole): string {
  return osEntryRoute(role).pathname;
}

/** Единая навигация после входа / квиза — quiz → project pick → OS tabs */
export async function navigateAfterLogin(role: UserRole): Promise<void> {
  await AsyncStorage.setItem('renova_user_role', role);
  const done = await AsyncStorage.getItem('renova_detail_quiz_done');
  if (!done) {
    router.replace('/onboarding/detail-quiz');
    return;
  }
  const pending = await AsyncStorage.getItem(SESSION_KEYS.pendingProjectPick);
  if (pending === '1') {
    router.replace(projectPickRoute() as Href);
    return;
  }
  replaceOsNav(osEntryRoute(role));
}
