/** Единый push/replace для OS-маршрутов — строка или { pathname, params } */
import { router } from 'expo-router';
import { parseOsHref, budgetTabHref, type OsRole, type OsTabRoute } from '@/constants/osSections';
import { withReturnTo } from '@/lib/osReturnTo';
import { resolveOsDeepLink } from '@/lib/osDeepLink';

export type OsNavHref = string | OsTabRoute;
export { resolveOsDeepLink } from '@/lib/osDeepLink';

export function toOsRoute(target: OsNavHref, returnTo?: string): OsTabRoute {
  if (typeof target !== 'string') return target;
  const deep = resolveOsDeepLink(target, returnTo);
  if (deep) return deep;
  return parseOsHref(target);
}

/** OS-вкладки — navigate (не push), иначе зависает стек tabs */
function isOsTabPath(pathname: string): boolean {
  return pathname.includes('/(tabs)/');
}

function navigateOsRoute(route: OsTabRoute) {
  if (isOsTabPath(route.pathname)) router.navigate(route as any);
  else router.push(route as any);
}

/** Push с returnTo — чтобы на целевом экране была полоска «Назад» */
export function pushOsNav(target: OsNavHref, returnTo?: string) {
  // Deep-link уже несёт returnTo в params — не дублируем через withReturnTo на «сырой» path
  if (typeof target === 'string' && resolveOsDeepLink(target, returnTo)) {
    navigateOsRoute(toOsRoute(target, returnTo));
    return;
  }
  const route = toOsRoute(target);
  navigateOsRoute(returnTo ? withReturnTo(route, returnTo) : route);
}

export function replaceOsNav(target: OsNavHref, returnTo?: string) {
  if (typeof target === 'string' && resolveOsDeepLink(target, returnTo)) {
    const href = toOsRoute(target, returnTo);
    router.replace(href as any);
    return;
  }
  const route = toOsRoute(target);
  const href = returnTo ? withReturnTo(route, returnTo) : route;
  // Expo Router web: replace({ pathname }) для tabs часто no-op — строка pathname работает
  if (isOsTabPath(href.pathname)) {
    const params = href.params;
    if (params && Object.keys(params).length > 0) {
      router.replace({ pathname: href.pathname, params } as any);
    } else {
      router.replace(href.pathname as any);
    }
    return;
  }
  router.replace(href as any);
}

/** returnTo для stack-экранов (documents и т.д.) */
export function budgetAnalyticsReturnTo(role: OsRole): string {
  return budgetTabHref(role, 'deviations');
}
