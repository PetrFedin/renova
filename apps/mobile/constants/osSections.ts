/** Renova OS — 4 столпа + сервисные маршруты */
import type { TabIconKey } from '@/components/renova/TabIcon';

export type OsRole = 'customer' | 'contractor';
export type OsSectionId = 'home' | 'object' | 'repair' | 'budget';

export type OsSection = {
  id: OsSectionId | 'chat' | 'calendar';
  label: string;
  routeName: string;
  icon: TabIconKey;
  hubTab?: string;
};

const CUSTOMER_CORE: OsSection[] = [
  { id: 'home', label: 'Главная', routeName: 'index', icon: 'home' },
  { id: 'object', label: 'Объект', routeName: 'object', icon: 'rooms' },
  { id: 'repair', label: 'Ремонт', routeName: 'repair', icon: 'works' },
  { id: 'budget', label: 'Деньги', routeName: 'budget', icon: 'budget' },
];

const CONTRACTOR_CORE: OsSection[] = [
  { id: 'home', label: 'Главная', routeName: 'index', icon: 'home' },
  { id: 'object', label: 'Объект', routeName: 'object', icon: 'rooms' },
  { id: 'repair', label: 'Ремонт', routeName: 'repair', icon: 'works' },
  { id: 'budget', label: 'Бюджет', routeName: 'budget', icon: 'budget' },
];

/** Верхнее меню «Ещё»: только то, чего нет в dock (не дублировать 4 столпа + chat) */
export const OS_MENU_SECTIONS: Record<OsRole, OsSection[]> = {
  customer: [
    { id: 'calendar', label: 'Сроки', routeName: 'calendar', icon: 'calendar' },
  ],
  contractor: [
    { id: 'calendar', label: 'Сроки', routeName: 'calendar', icon: 'calendar' },
  ],
};

/** Утилиты шапки «Ещё» — вместе с OS_MENU_SECTIONS ≤ MAX_HEADER_MORE_ITEMS */
export const MAX_HEADER_MORE_ITEMS = 6;

export const OS_MORE_UTIL_LINKS: {
  id: string;
  label: string;
  href: string;
  icon: 'time-outline' | 'document-text-outline' | 'mail-unread-outline' | 'checkmark-done-outline';
}[] = [
  { id: 'inbox', label: 'Входящие', href: '/inbox', icon: 'mail-unread-outline' },
  { id: 'approvals', label: 'Согласования', href: '/approvals', icon: 'checkmark-done-outline' },
  { id: 'documents', label: 'Документы', href: '/documents', icon: 'document-text-outline' },
  { id: 'activity', label: 'Архив ремонта', href: '/activity', icon: 'time-outline' },
];

export const OS_SECTIONS: Record<OsRole, OsSection[]> = {
  customer: CUSTOMER_CORE,
  contractor: CONTRACTOR_CORE,
};

const DIRECT: Record<string, OsSectionId> = {
  index: 'home',
  object: 'object',
  repair: 'repair',
  budget: 'budget',
};

/** Старые/скрытые маршруты → канонический раздел OS */
const ALIAS: Record<string, OsSectionId> = {
  works: 'repair',
  materials: 'repair',
  control: 'repair',
  stages: 'repair',
  plan: 'object',
  rooms: 'object',
  estimate: 'object',
  finance: 'budget',
  money: 'budget',
  objects: 'home',
  chat: 'home',
  profile: 'home',
  guide: 'home',
  more: 'home',
};

const ROUTE_TITLES: Record<string, { customer: string; contractor: string }> = {
  chat: { customer: 'Сообщения', contractor: 'Сообщения' },
  object: { customer: 'Объект', contractor: 'Объект' },
  repair: { customer: 'Ремонт', contractor: 'Ремонт' },
  calendar: { customer: 'Сроки', contractor: 'Сроки' },
  estimate: { customer: 'Смета', contractor: 'Смета' },
  rooms: { customer: 'Комнаты', contractor: 'Комнаты' },
  profile: { customer: 'Данные объекта', contractor: 'Данные объекта' },
  finance: { customer: 'Деньги', contractor: 'Финансы' },
  budget: { customer: 'Деньги', contractor: 'Бюджет' },
  guide: { customer: 'Справка', contractor: 'Справка' },
  plan: { customer: 'План', contractor: 'План' },
  works: { customer: 'Этапы', contractor: 'Этапы' },
  materials: { customer: 'Материалы', contractor: 'Материалы' },
  control: { customer: 'Приёмка', contractor: 'Приёмка' },
};

function routeSegment(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last || last === '(tabs)') return 'index';
  return last;
}

export function resolveSectionId(pathname: string): OsSectionId {
  const seg = routeSegment(pathname);
  return DIRECT[seg] || ALIAS[seg] || 'home';
}

export function sectionTitle(role: OsRole, pathname: string): string {
  const seg = routeSegment(pathname);
  const routeTitle = ROUTE_TITLES[seg];
  if (routeTitle) return routeTitle[role];
  const id = resolveSectionId(pathname);
  return OS_SECTIONS[role].find((s) => s.id === id)?.label || 'Renova';
}

export function tabsPrefix(role: OsRole): string {
  return role === 'customer' ? '/(customer)/(tabs)' : '/(contractor)/(tabs)';
}

/** Маршрут OS-вкладки для router.push/replace — tab в params, не в строке URL */
export type OsTabRoute = { pathname: string; params?: Record<string, string> };

export function tabsRoute(
  role: OsRole,
  routeName: string,
  hubTab?: string,
  extra?: Record<string, string>,
): OsTabRoute {
  const base = tabsPrefix(role);
  const pathname = routeName === 'index' ? `${base}/` : `${base}/${routeName}`;
  const params: Record<string, string> = { ...(extra || {}) };
  if (hubTab) params.tab = hubTab;
  return Object.keys(params).length > 0 ? { pathname, params } : { pathname };
}

/** Парсинг legacy href с ?tab= → объект для Expo Router */
export function parseOsHref(href: string): OsTabRoute {
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

/** Канонический href (строка) — для breadcrumb и legacy Redirect */
export function tabsHref(role: OsRole, routeName: string, hubTab?: string): string {
  const r = tabsRoute(role, routeName, hubTab);
  if (!r.params) return r.pathname;
  const qs = new URLSearchParams(r.params).toString();
  return `${r.pathname}?${qs}`;
}

export function repairTabHref(role: OsRole, tab: string, filter?: string): string {
  return tabsHref(role, 'repair', tab) + (filter ? `&filter=${filter}` : '');
}

export function repairTabRoute(role: OsRole, tab: string, filter?: string): OsTabRoute {
  return tabsRoute(role, 'repair', tab, filter ? { filter } : undefined);
}

export function calendarTabHref(role: OsRole, extra?: Record<string, string>): string {
  const r = tabsRoute(role, 'calendar', undefined, extra);
  if (!r.params) return r.pathname;
  const qs = new URLSearchParams(r.params).toString();
  return `${r.pathname}?${qs}`;
}

export function calendarTabRoute(role: OsRole, extra?: Record<string, string>): OsTabRoute {
  return tabsRoute(role, 'calendar', undefined, extra);
}


export function customerProfileTabHref(role: OsRole, focus?: string): string {
  const r = tabsRoute(role, 'profile', undefined, focus ? { focus } : undefined);
  if (!r.params) return r.pathname;
  const qs = new URLSearchParams(r.params).toString();
  return `${r.pathname}?${qs}`;
}

export function objectTabHref(role: OsRole, tab: string, sub?: string): string {
  return tabsHref(role, 'object', tab) + (sub ? `&sub=${sub}` : '');
}

export function objectTabRoute(role: OsRole, tab: string, sub?: string): OsTabRoute {
  return tabsRoute(role, 'object', tab, sub ? { sub } : undefined);
}

export function budgetTabHref(
  role: OsRole,
  tab: string,
  params?: { roomId?: string; stageId?: string; period?: string; focus?: string; view?: string },
): string {
  const extra: Record<string, string> = {};
  if (params?.roomId) extra.roomId = params.roomId;
  if (params?.stageId) extra.stageId = params.stageId;
  if (params?.period) extra.period = params.period;
  if (params?.focus) extra.focus = params.focus;
  if (params?.view) extra.view = params.view;
  const r = tabsRoute(role, 'budget', tab, Object.keys(extra).length ? extra : undefined);
  if (!r.params) return r.pathname;
  const qs = new URLSearchParams(r.params).toString();
  return `${r.pathname}?${qs}`;
}

export function budgetTabRoute(
  role: OsRole,
  tab: string,
  params?: { roomId?: string; stageId?: string; period?: string; focus?: string; view?: string },
): OsTabRoute {
  const extra: Record<string, string> = {};
  if (params?.roomId) extra.roomId = params.roomId;
  if (params?.stageId) extra.stageId = params.stageId;
  if (params?.period) extra.period = params.period;
  if (params?.focus) extra.focus = params.focus;
  if (params?.view) extra.view = params.view;
  return tabsRoute(role, 'budget', tab, Object.keys(extra).length ? extra : undefined);
}
