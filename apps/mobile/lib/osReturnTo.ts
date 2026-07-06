/** Чистые хелперы returnTo — без expo-router (для тестов и push) */
import { parseOsHref, sectionTitle, tabsPrefix, type OsRole, type OsTabRoute } from '../constants/osSections';

export function homeReturnTo(role: OsRole): string {
  return `${tabsPrefix(role)}/`;
}

export function withReturnTo(route: OsTabRoute, returnTo: string): OsTabRoute {
  return {
    pathname: route.pathname,
    params: { ...(route.params || {}), returnTo },
  };
}

function routeSegment(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last || last === '(tabs)') return 'index';
  return last;
}

/** Человекочитаемая подпись для полоски «Назад · …» */
export function returnToLabel(returnTo: string, role: OsRole): string | undefined {
  const { pathname, params } = parseOsHref(returnTo);
  const seg = routeSegment(pathname);
  if (seg === 'index') return 'Главная';

  const prefix = tabsPrefix(role);
  const isOsTab = pathname.startsWith(prefix);

  if (returnTo.includes('/inbox')) return 'Входящие';
  if (returnTo.includes('/documents')) return 'Документы';
  if (returnTo.includes('/reports')) return 'Отчёты';
  if (returnTo.includes('/budget')) {
    const tab = params?.tab;
    if (tab === 'payments') return 'Бюджет · Оплаты';
    if (tab === 'expenses') return 'Бюджет · Расходы';
    if (tab === 'summary') return 'Бюджет · Сводка';
    return 'Бюджет';
  }
  if (returnTo.includes('/repair')) return 'Ремонт';
  if (returnTo.includes('/object')) return 'Объект';
  if (returnTo.includes('/profile')) return 'Профиль';
  if (returnTo.includes('/calendar')) return 'Календарь';

  if (isOsTab) {
    const title = sectionTitle(role, pathname);
    if (title !== 'Renova') return title;
  }
  return undefined;
}
