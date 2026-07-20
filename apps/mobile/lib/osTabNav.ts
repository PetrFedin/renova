/** Навигация между вкладками OS с сохранением пути «назад» */
import { router } from 'expo-router';
import { tabsRoute, type OsRole, type OsTabRoute } from '@/constants/osSections';
import { homeReturnTo, withReturnTo } from '@/lib/osReturnTo';
import { toOsRoute } from '@/lib/pushOsNav';

export { homeReturnTo, withReturnTo, returnToLabel } from '@/lib/osReturnTo';

/** Переход на вкладку OS — push (не replace), с returnTo для кнопки «Назад» */
export function pushOsTabNav(
  role: OsRole,
  routeName: string,
  hubTab?: string,
  extra?: Record<string, string>,
  returnTo?: string,
) {
  const rt = returnTo ?? homeReturnTo(role);
  const params: Record<string, string> = { ...(extra || {}), returnTo: rt };
  router.navigate(tabsRoute(role, routeName, hubTab, params) as any);
}

/** W110: строковые href через toOsRoute → resolvePushLink */
export function pushOsHrefWithReturn(href: string | OsTabRoute, returnTo: string, role: OsRole = 'customer') {
  if (typeof href === 'string') {
    const route = toOsRoute(href, returnTo, role);
    if (route.pathname.includes('/(tabs)/')) router.navigate(route as any);
    else router.push(route as any);
    return;
  }
  const full = withReturnTo(href, returnTo);
  if (full.pathname.includes('/(tabs)/')) router.navigate(full as any);
  else router.push(full as any);
}
