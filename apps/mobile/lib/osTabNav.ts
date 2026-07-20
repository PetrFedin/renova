/** Навигация между вкладками OS с сохранением пути «назад» */
import { router } from 'expo-router';
import { tabsRoute, type OsRole, type OsTabRoute } from '@/constants/osSections';
import { homeReturnTo, withReturnTo } from '@/lib/osReturnTo';
import { resolveOsDeepLink, toOsRoute } from '@/lib/pushOsNav';

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

/** W107: /stage/{id} и др. → dynamic segments через toOsRoute */
export function pushOsHrefWithReturn(href: string | OsTabRoute, returnTo: string) {
  if (typeof href === 'string' && resolveOsDeepLink(href, returnTo)) {
    router.push(toOsRoute(href, returnTo) as any);
    return;
  }
  const route = toOsRoute(href);
  const full = withReturnTo(route, returnTo);
  if (full.pathname.includes('/(tabs)/')) router.navigate(full as any);
  else router.push(full as any);
}
