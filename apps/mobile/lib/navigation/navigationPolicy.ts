import { DOCK_BY_ID, type DockItemId } from '../../constants/dockBar';
import {
  calendarTabRoute,
  tabsRoute,
  type OsRole,
  type OsTabRoute,
} from '../../constants/osSections';
import {
  RENOVA_ROUTES,
  routesForAudience,
  type RegistryRedirectTarget,
  type RenovaRoute,
} from '../routeRegistry';

export type SecondarySurface = 'header' | 'home';
export type NavigationPhase = 'setup' | 'active' | 'closing' | 'complete';

export function getBudgetHubLabel(role: OsRole): string {
  return role === 'customer' ? 'Деньги' : 'Бюджет';
}

export function getRouteLabel(route: RenovaRoute, role: OsRole): string {
  return route.id === 'budget' ? getBudgetHubLabel(role) : route.titleRu;
}

export function canonicalRouteIdForDockItem(id: DockItemId): string {
  if (id === 'estimate') return 'object';
  if (id === 'contractor' || id === 'more') return 'home';
  return id;
}

export function resolveRegistryRedirect(
  targetOrId: RegistryRedirectTarget | string,
  role: OsRole,
  params: Record<string, string> = {},
): OsTabRoute | null {
  const target = typeof targetOrId === 'string'
    ? RENOVA_ROUTES.find((route) => route.id === targetOrId)?.redirectTarget
    : targetOrId;
  if (!target) return null;
  const merged = { ...(target.params || {}), ...params };
  switch (target.routeId) {
    case 'object': return tabsRoute(role, 'object', target.tab, merged);
    case 'repair': return tabsRoute(role, 'repair', target.tab, merged);
    case 'budget': return tabsRoute(role, 'budget', target.tab, merged);
    case 'calendar': return calendarTabRoute(role, merged);
    case 'documents': return { pathname: '/documents', params: merged };
    case 'inbox': return { pathname: '/inbox', params: merged };
    case 'quality-control': return { pathname: '/quality-control', params: merged };
    default: return null;
  }
}

const HEADER_UTILITY_IDS = ['documents', 'inbox', 'approvals', 'activity'] as const;
const HOME_MORE_IDS = ['documents', 'inbox', 'approvals', 'activity', 'manager-dashboard', 'reports'] as const;
const GUEST_IDS = new Set(['documents', 'inbox']);

export function buildSecondaryNavigation(input: {
  role: OsRole;
  readOnly?: boolean;
  guest?: boolean;
  phase?: NavigationPhase;
  dockItems?: readonly DockItemId[];
  excludeRouteIds?: readonly string[];
  surface: SecondarySurface;
}): RenovaRoute[] {
  const dockIds = new Set((input.dockItems || []).map(canonicalRouteIdForDockItem));
  const ordered = input.surface === 'header'
    ? ['calendar', ...HEADER_UTILITY_IDS]
    : [...HOME_MORE_IDS];
  const allowed = input.readOnly || input.guest ? GUEST_IDS : null;
  const excluded = new Set(input.excludeRouteIds || []);
  const routes = routesForAudience(input.role);
  const byId = new Map(routes.map((route) => [route.id, route]));
  const seen = new Set<string>();
  const result: RenovaRoute[] = [];
  for (const id of ordered) {
    const route = byId.get(id);
    if (!route || seen.has(route.id) || dockIds.has(route.id) || excluded.has(route.id)) continue;
    if (input.role === 'contractor' && route.id === 'approvals') continue;
    if (route.status === 'wip' || route.redirectTarget || route.visibility === 'hidden') continue;
    if (allowed && !allowed.has(route.id)) continue;
    if ((route.id === 'manager-dashboard' || route.id === 'reports') && input.phase !== 'complete') continue;
    seen.add(route.id);
    result.push(route);
  }
  return result.slice(0, input.surface === 'home' ? 5 : 6);
}

export type DockRouteState = { pathname: string; params?: Record<string, string | string[] | undefined> };

/** Active dock state is exclusive, including setup's Object + Estimate shortcut. */
export function activeDockItemId(items: readonly DockItemId[], state: DockRouteState): DockItemId | null {
  const seg = state.pathname.split('/').filter(Boolean).pop() || 'index';
  const rawTab = state.params?.tab;
  const tab = Array.isArray(rawTab) ? rawTab[0] : rawTab;
  const objectRoute = ['object', 'rooms', 'estimate', 'plan'].includes(seg);
  const candidate: DockItemId =
    (objectRoute && tab === 'estimate' && items.includes('estimate')) ? 'estimate'
      : objectRoute ? 'object'
        : ['repair', 'works', 'materials', 'control', 'stages'].includes(seg) ? 'repair'
          : ['budget', 'finance', 'money'].includes(seg) ? 'budget'
            : seg === 'calendar' ? 'calendar'
              : seg === 'chat' ? 'chat'
                : seg === 'profile' ? (items.includes('contractor') ? 'contractor' : 'more')
                  : 'home';
  return items.includes(candidate) && DOCK_BY_ID[candidate] ? candidate : null;
}

export function warrantyRoute(role: OsRole, params: Record<string, string> = {}): OsTabRoute {
  const context = { tab: 'warranty', ...params };
  return role === 'contractor'
    ? { pathname: '/quality-control', params: { ...context, filter: 'warranty' } }
    : { pathname: '/documents', params: context };
}

export function navigationTargetHref(target: OsTabRoute): string {
  if (!target.params || Object.keys(target.params).length === 0) return target.pathname;
  return `${target.pathname}?${new URLSearchParams(target.params).toString()}`;
}
