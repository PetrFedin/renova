/** Прямой переход в OS после онбординга — без лишних redirect */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { UserRole } from '@/lib/api';
import { tabsRoute, type OsTabRoute } from '@/constants/osSections';
import { SESSION_KEYS } from '@/constants/sessionKeys';
import { replaceOsNav } from '@/lib/pushOsNav';

const REVIEW_MODE_ENABLED = (process.env.EXPO_PUBLIC_REVIEW_MODE ?? '0') === '1';

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
  const pending = await AsyncStorage.getItem(SESSION_KEYS.pendingProjectPick);
  if (REVIEW_MODE_ENABLED && pending === '1') {
    await AsyncStorage.setItem('renova_detail_level', 'standard');
    await AsyncStorage.setItem('renova_detail_quiz_done', '1');
    replaceOsNav(projectPickRoute());
    return;
  }
  const done = await AsyncStorage.getItem('renova_detail_quiz_done');
  if (!done) {
    // W120: онбординг через SoT
    replaceOsNav('/onboarding/detail-quiz');
    return;
  }
  if (pending === '1') {
    replaceOsNav(projectPickRoute());
    return;
  }
  replaceOsNav(osEntryRoute(role));
}
