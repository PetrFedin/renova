/**
 * P2.7 / W52: единый resolver для root `[slug].tsx`.
 * Legacy / registry redirects → канон; неизвестное → not_found (не «второй продукт»).
 */
import {
  budgetTabRoute,
  calendarTabRoute,
  objectTabHref,
  type OsRole,
  type OsTabRoute,
} from '@/constants/osSections';
import { RENOVA_ROUTES } from '@/lib/routeRegistry';
import { logLegacyRouteDeprecation } from '@/lib/legacyRoutes';

export type CatchAllResolution =
  | { kind: 'stack' }
  | { kind: 'redirect'; href: string | OsTabRoute; canonical: string }
  | { kind: 'not_found'; slug: string };

/** Slug → канон (без зависимостей от React). */
export function legacySlugRedirect(seg: string, role: OsRole): OsTabRoute | string | null {
  switch (seg) {
    case 'notifications':
      return { pathname: '/inbox' };
    case 'work-schedule':
      return calendarTabRoute(role);
    case 'finance-center':
      return budgetTabRoute(role, 'payments');
    case 'project-analytics':
      return budgetTabRoute(role, 'deviations');
    case 'design':
      return objectTabHref(role, 'plan', 'design');
    case 'control':
      // W56: contractor hub приёмки = repair control; QC — отдельный /quality-control
      return role === 'contractor'
        ? { pathname: '/(contractor)/(tabs)/repair', params: { tab: 'control' } }
        : '/work-acceptance';
    case 'warranty-claim':
    case 'warranty':
      // W55: заказчик → документы; исполнитель → QC
      return role === 'contractor' ? '/quality-control' : '/documents';
    default:
      break;
  }
  // Registry redirectTo by id or path suffix
  const byId = RENOVA_ROUTES.find((r) => r.id === seg && r.redirectTo);
  if (byId?.redirectTo) return byId.redirectTo;
  const byPath = RENOVA_ROUTES.find((r) => r.path === `/${seg}` && r.redirectTo);
  if (byPath?.redirectTo) return byPath.redirectTo;
  return null;
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
] as const;
