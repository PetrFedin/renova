/**
 * Typed route registry (A-04 / A-07).
 * Dock ≤ 4 tabs. Secondary centers живут в visibility: 'more'.
 * WIP не попадает в меню.
 */

export type RouteAudience = 'customer' | 'contractor' | 'both';
export type RouteVisibility = 'dock' | 'more' | 'hidden' | 'deeplink';
export type RouteStatus = 'ga' | 'beta' | 'wip';

export type RenovaRoute = {
  id: string;
  path: string;
  titleRu: string;
  audience: RouteAudience;
  visibility: RouteVisibility;
  status: RouteStatus;
  entryPoints: string[];
  descriptionRu?: string;
  /** P0.2: tap on pending payment opens this sheet instead of direct confirm */
  opensSheet?: 'payment';
  /** Optional redirect when route is a thin wrapper over a tab */
  redirectTo?: string;
};

/** Canonical product routes — единый реестр для меню и аудита. */
export const RENOVA_ROUTES: RenovaRoute[] = [
  // Dock
  { id: 'home', path: '/index', titleRu: 'Главная', audience: 'both', visibility: 'dock', status: 'ga', entryPoints: ['tabs'] },
  { id: 'object', path: '/object', titleRu: 'Объект', audience: 'both', visibility: 'dock', status: 'ga', entryPoints: ['tabs'] },
  { id: 'repair', path: '/repair', titleRu: 'Ремонт', audience: 'both', visibility: 'dock', status: 'ga', entryPoints: ['tabs'] },
  { id: 'budget', path: '/budget', titleRu: 'Бюджет', audience: 'both', visibility: 'dock', status: 'ga', entryPoints: ['tabs'] },

  // Secondary centers (More)
  {
    id: 'manager-dashboard',
    path: '/manager-dashboard',
    titleRu: 'Управленческая сводка',
    audience: 'both',
    visibility: 'more',
    status: 'beta',
    entryPoints: ['home.more'],
    descriptionRu: 'KPI и сводка по проекту',
  },
  {
    id: 'finance-center',
    path: '/finance-center',
    titleRu: 'Финансовый центр',
    audience: 'both',
    visibility: 'more',
    status: 'beta',
    entryPoints: ['home.more'],
    opensSheet: 'payment',
    redirectTo: '/budget?tab=payments',
    descriptionRu: 'Сводка финансов; оплата — через PaymentDetailSheet (gate приёмки)',
  },
  {
    id: 'quality-control',
    path: '/quality-control',
    titleRu: 'Контроль качества',
    audience: 'both',
    visibility: 'more',
    status: 'beta',
    entryPoints: ['home.more'],
  },
  {
    id: 'work-acceptance',
    path: '/work-acceptance',
    titleRu: 'Приёмка работ',
    audience: 'both',
    visibility: 'more',
    status: 'ga',
    entryPoints: ['home.more', 'stage'],
  },
  {
    id: 'work-schedule',
    path: '/work-schedule',
    titleRu: 'График работ',
    audience: 'both',
    visibility: 'more',
    status: 'beta',
    entryPoints: ['home.schedule', 'home.more'],
  },
  {
    id: 'documents',
    path: '/documents',
    titleRu: 'Документы проекта',
    audience: 'both',
    visibility: 'more',
    status: 'beta',
    entryPoints: ['home.more'],
  },
  {
    id: 'notifications',
    path: '/notifications',
    titleRu: 'Уведомления',
    audience: 'both',
    visibility: 'more',
    status: 'beta',
    entryPoints: ['home.more', 'deeplink'],
  },

  // Hidden / deeplink legacy tabs
  { id: 'calendar', path: '/calendar', titleRu: 'Календарь', audience: 'both', visibility: 'deeplink', status: 'ga', entryPoints: ['home.schedule'] },
  { id: 'conflicts', path: '/conflicts', titleRu: 'Конфликты sync', audience: 'contractor', visibility: 'deeplink', status: 'ga', entryPoints: ['offline.banner'] },
  { id: 'reports', path: '/reports', titleRu: 'Отчёты', audience: 'both', visibility: 'hidden', status: 'wip', entryPoints: [] },
  { id: 'project-analytics', path: '/project-analytics', titleRu: 'Аналитика', audience: 'both', visibility: 'hidden', status: 'wip', entryPoints: [] },
];

export function routesForAudience(audience: 'customer' | 'contractor'): RenovaRoute[] {
  return RENOVA_ROUTES.filter((r) => r.audience === 'both' || r.audience === audience);
}

export function menuRoutes(
  audience: 'customer' | 'contractor',
  visibility: RouteVisibility | RouteVisibility[] = 'more',
): RenovaRoute[] {
  const vis = Array.isArray(visibility) ? visibility : [visibility];
  return routesForAudience(audience).filter(
    (r) => vis.includes(r.visibility) && r.status !== 'wip',
  );
}

export function assertRouteRegistryInvariants(routes: RenovaRoute[] = RENOVA_ROUTES): void {
  const dock = routes.filter((r) => r.visibility === 'dock');
  if (dock.length > 4) {
    throw new Error(`Dock exceeds 4 tabs: ${dock.length}`);
  }
  for (const r of routes) {
    if (!r.id || !r.path || !r.titleRu) {
      throw new Error(`Invalid route: ${JSON.stringify(r)}`);
    }
    if ((r.visibility === 'dock' || r.visibility === 'more') && r.status !== 'wip' && r.entryPoints.length === 0) {
      throw new Error(`Visible route ${r.id} has no entryPoints`);
    }
  }
}
