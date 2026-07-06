import { parseOsHref, sectionTitle, tabsHref, tabsRoute, type OsRole } from '@/constants/osSections';

export type Crumb = { label: string; routeName: string };

export type BreadcrumbContext = {
  /** Активная вкладка hub (repair/budget/object) */
  hubTab?: string;
  sub?: string;
  filter?: string;
};

/** Подписи вкладок hub — третий уровень крошек */
export const HUB_TAB_LABELS: Record<string, Record<string, string>> = {
  repair: { works: 'Этапы', materials: 'Материалы', control: 'Приёмка' },
  budget: {
    summary: 'Сводка',
    expenses: 'Расходы',
    payments: 'Оплаты',
    deviations: 'Отклонения',
    rooms: 'Расходы',
    stages: 'Расходы',
    analytics: 'Отклонения',
  },
  object: { profile: 'Профиль', rooms: 'Комнаты', estimate: 'Смета', plan: 'План' },
};

const HUB_ROUTES = new Set(['object', 'repair', 'budget']);

function routeSegment(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last || last === '(tabs)') return 'index';
  return last;
}

function hubTabLabel(hubRoute: string, tab?: string): string | undefined {
  if (!tab) return undefined;
  return HUB_TAB_LABELS[hubRoute]?.[tab];
}

/** routeName для вкладки hub: repair:control */
export function hubTabRouteName(hubRoute: string, tab: string): string {
  return `${hubRoute}:${tab}`;
}

export function parseHubTabRouteName(routeName: string): { hub: string; tab: string } | null {
  const idx = routeName.indexOf(':');
  if (idx <= 0) return null;
  return { hub: routeName.slice(0, idx), tab: routeName.slice(idx + 1) };
}

/** Хлебные крошки: Главная › раздел › вкладка hub */
export function buildBreadcrumb(role: OsRole, pathname: string, ctx?: BreadcrumbContext): Crumb[] {
  const seg = routeSegment(pathname);
  const home: Crumb = { label: 'Главная', routeName: 'index' };
  if (seg === 'index') return [home];

  const title = sectionTitle(role, pathname);
  const crumbs: Crumb[] = [home, { label: title, routeName: seg }];

  if (HUB_ROUTES.has(seg) && ctx?.hubTab) {
    const tabLabel = hubTabLabel(seg, ctx.hubTab);
    if (tabLabel) {
      crumbs.push({ label: tabLabel, routeName: hubTabRouteName(seg, ctx.hubTab) });
    }
  }

  return crumbs;
}

export function crumbHref(role: OsRole, routeName: string): string {
  return tabsHref(role, routeName);
}

/** Подпись «Ремонт › Приёмка» для stack-экранов по returnTo */
export function formatReturnToTrail(returnTo: string | undefined, role: OsRole): string | undefined {
  if (!returnTo) return undefined;
  const { pathname, params } = parseOsHref(returnTo);
  const seg = routeSegment(pathname);
  if (seg === 'index') return 'Главная';
  if (HUB_ROUTES.has(seg) && params?.tab) {
    const tabLabel = hubTabLabel(seg, params.tab);
    if (tabLabel) return `${sectionTitle(role, pathname)} › ${tabLabel}`;
  }
  if (returnTo.includes('/inbox')) return 'Входящие';
  if (returnTo.includes('/documents')) return 'Документы';
  if (returnTo.includes('/reports')) return 'Отчёты';
  if (returnTo.includes('/budget')) return sectionTitle(role, pathname);
  if (returnTo.includes('/repair')) return 'Ремонт';
  if (returnTo.includes('/object')) return 'Объект';
  return undefined;
}

/** Навигация по крошке hub-вкладки */
export function hubCrumbRoute(role: OsRole, routeName: string, ctx?: Pick<BreadcrumbContext, 'sub' | 'filter'>) {
  const parsed = parseHubTabRouteName(routeName);
  if (!parsed) return tabsRoute(role, routeName);
  const extra: Record<string, string> = {};
  if (parsed.hub === 'object' && ctx?.sub) extra.sub = ctx.sub;
  if (parsed.hub === 'repair' && ctx?.filter) extra.filter = ctx.filter;
  return tabsRoute(role, parsed.hub, parsed.tab, Object.keys(extra).length ? extra : undefined);
}
