/** Прямой переход в OS после онбординга — без лишних redirect */
import type { UserRole } from '@/lib/api';
import { tabsRoute, type OsTabRoute } from '@/constants/osSections';

export function osEntryRoute(role: UserRole): OsTabRoute {
  return tabsRoute(role === 'contractor' ? 'contractor' : 'customer', 'index');
}

/** Экран выбора объекта после входа */
export function projectPickRoute(): string {
  return '/onboarding/project';
}

/** @deprecated Используйте osEntryRoute + router.replace(route) */
export function osEntryHref(role: UserRole): string {
  return osEntryRoute(role).pathname;
}
