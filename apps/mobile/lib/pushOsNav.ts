/** Единый push/replace для OS-маршрутов — строка или { pathname, params } */
import { router } from 'expo-router';
import { budgetTabHref, type OsRole, type OsTabRoute } from '@/constants/osSections';
import { withReturnTo } from '@/lib/osReturnTo';
import { resolvePushLink } from '@/lib/pushLinks';

export type OsNavHref = string | OsTabRoute;
export { resolveOsDeepLink } from '@/lib/osDeepLink';

/**
 * W110: строковый href → Expo route через resolvePushLink
 * (deep-link /stage, TAB_ALIASES, /control, finance-center — один SoT с пушами).
 */
export function toOsRoute(target: OsNavHref, returnTo?: string, role: OsRole = 'customer'): OsTabRoute {
  if (typeof target !== 'string') return target;
  const resolved = resolvePushLink(target, returnTo, role);
  if (resolved) {
    return { pathname: resolved.pathname, params: resolved.params };
  }
  return { pathname: target };
}

/** OS-вкладки — navigate (не push), иначе зависает стек tabs */
function isOsTabPath(pathname: string): boolean {
  return pathname.includes('/(tabs)/');
}

function navigateOsRoute(route: OsTabRoute) {
  if (isOsTabPath(route.pathname)) router.navigate(route as any);
  else router.push(route as any);
}

/** Push с returnTo; role нужен для /control и short aliases */
export function pushOsNav(target: OsNavHref, returnTo?: string, role: OsRole = 'customer') {
  if (typeof target === 'string') {
    // resolvePushLink уже кладёт returnTo в params
    navigateOsRoute(toOsRoute(target, returnTo, role));
    return;
  }
  const route = target;
  navigateOsRoute(returnTo ? withReturnTo(route, returnTo) : route);
}

export function replaceOsNav(target: OsNavHref, returnTo?: string, role: OsRole = 'customer') {
  if (typeof target === 'string') {
    const href = toOsRoute(target, returnTo, role);
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
    return;
  }
  const href = returnTo ? withReturnTo(target, returnTo) : target;
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
