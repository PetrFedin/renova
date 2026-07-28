/**
 * P2.7 / W52: единый resolver для root `[slug].tsx`.
 * Legacy / registry redirects → канон; неизвестное → not_found (не «второй продукт»).
 */
import {
  budgetTabRoute,
  calendarTabRoute,
  objectTabHref,
  repairTabRoute,
  tabsRoute,
  type OsRole,
  type OsTabRoute,
} from '../constants/osSections';
import { RENOVA_ROUTES } from './routeRegistry';
import { logLegacyRouteDeprecation } from './legacyRoutes';

export type CatchAllResolution =
  | { kind: 'stack' }
  | { kind: 'redirect'; href: string | OsTabRoute; canonical: string }
  | { kind: 'not_found'; slug: string };

/** Slug → канон (без зависимостей от React). Всегда role-aware — не сырой `/repair?…`. */
export function legacySlugRedirect(seg: string, role: OsRole): OsTabRoute | string | null {
  switch (seg) {
    case 'notifications':
      return { pathname: '/inbox' };
    case 'work-schedule':
      return calendarTabRoute(role);
    case 'finance-center':
      return budgetTabRoute(role, 'payments', { openPayment: '1' });
    case 'project-analytics':
      return budgetTabRoute(role, 'deviations');
    case 'design':
      return objectTabHref(role, 'plan', 'design');
    case 'control':
    case 'work-acceptance':
      // W58: единый hub приёмки для обеих ролей
      return repairTabRoute(role, 'control');
    case 'materials-procurement':
      // P0 IA: role tabs + subtab, не bare `/repair?…` вне (customer|contractor)
      return tabsRoute(role, 'repair', 'materials', { subtab: 'purchases' });
    case 'selections':
      return repairTabRoute(role, 'selections');
    case 'warranty-claim':
    case 'warranty':
      // W126: обе роли → QC (заказчик закрывает тикеты; документы — closeout)
      return '/quality-control';
    default:
      break;
  }
  // Registry redirectTo — только через roleAware (сырой `/repair?…` опасен без роли)
  const byId = RENOVA_ROUTES.find((r) => r.id === seg && r.redirectTo);
  if (byId?.redirectTo) {
    const fixed = roleAwareRegistryRedirect(byId.redirectTo, role);
    if (fixed) return fixed;
  }
  const byPath = RENOVA_ROUTES.find((r) => r.path === `/${seg}` && r.redirectTo);
  if (byPath?.redirectTo) {
    const fixed = roleAwareRegistryRedirect(byPath.redirectTo, role);
    if (fixed) return fixed;
  }
  return null;
}

/**
 * Превращает сырой registry `redirectTo` в role-aware href.
 * Stack/inbox/QC оставляем; `/repair|budget|calendar|object` — через tabsRoute.
 */
export function roleAwareRegistryRedirect(
  redirectTo: string,
  role: OsRole,
): OsTabRoute | string | null {
  if (!redirectTo.startsWith('/')) return null;

  // Уже с группой роли — парсим query в params
  if (redirectTo.startsWith('/(customer)') || redirectTo.startsWith('/(contractor)')) {
    return parseHrefToRoute(redirectTo);
  }

  // Абсолютные attention / QC stack — без роли
  if (
    redirectTo === '/inbox' ||
    redirectTo.startsWith('/inbox?') ||
    redirectTo.startsWith('/quality-control')
  ) {
    return redirectTo;
  }

  const parsed = parseHrefToRoute(redirectTo);
  const path = parsed.pathname;
  const params = { ...(parsed.params || {}) };

  switch (path) {
    case '/repair': {
      const tab = params.tab || 'works';
      delete params.tab;
      return tabsRoute(role, 'repair', tab, Object.keys(params).length ? params : undefined);
    }
    case '/budget': {
      const tab = params.tab || 'summary';
      delete params.tab;
      return tabsRoute(role, 'budget', tab, Object.keys(params).length ? params : undefined);
    }
    case '/calendar':
      return calendarTabRoute(role, Object.keys(params).length ? params : undefined);
    case '/object': {
      const tab = params.tab || 'overview';
      delete params.tab;
      return tabsRoute(role, 'object', tab, Object.keys(params).length ? params : undefined);
    }
    default:
      // Неизвестный bare path — не отдаём сырой redirect (избегаем тупика вне role)
      return null;
  }
}

function parseHrefToRoute(href: string): OsTabRoute {
  const qIdx = href.indexOf('?');
  if (qIdx === -1) return { pathname: href };
  const pathname = href.slice(0, qIdx);
  const params: Record<string, string> = {};
  for (const part of href.slice(qIdx + 1).split('&')) {
    const [k, v] = part.split('=');
    if (k && v != null) params[k] = decodeURIComponent(v);
  }
  return { pathname, params };
}

export function resolveCatchAllSlug(
  seg: string | undefined,
  role: OsRole,
  stackKeys: ReadonlySet<string> | readonly string[],
): CatchAllResolution {
  if (!seg) return { kind: 'not_found', slug: '' };
  const stack = stackKeys instanceof Set ? stackKeys : new Set(stackKeys);
  if (stack.has(seg)) return { kind: 'stack' };

  const href = legacySlugRedirect(seg, role);
  if (href) {
    const canonical = typeof href === 'string' ? href : href.pathname;
    logLegacyRouteDeprecation(`/${seg}`, canonical);
    return { kind: 'redirect', href, canonical };
  }
  return { kind: 'not_found', slug: seg };
}

/** Известные legacy slug (для аудита / тестов). */
export const KNOWN_LEGACY_SLUGS = [
  'notifications',
  'work-schedule',
  'finance-center',
  'project-analytics',
  'design',
  'control',
  'work-acceptance',
  'materials-procurement',
  'selections',
] as const;
