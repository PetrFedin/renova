/** Навигация между вкладками OS с сохранением пути «назад» */
import { router } from 'expo-router';
import { tabsRoute, type OsRole, type OsTabRoute } from '@/constants/osSections';
import { homeReturnTo } from '@/lib/osReturnTo';
import { pushOsNav } from '@/lib/pushOsNav';

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

/** W119: href → единый pushOsNav (aliases / role / returnTo) */
export function pushOsHrefWithReturn(href: string | OsTabRoute, returnTo: string, role: OsRole = 'customer') {
  pushOsNav(href, returnTo, role);
}
