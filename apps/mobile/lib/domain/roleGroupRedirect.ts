/**
 * Группы маршрутов `(customer)` и `(contractor)` дают одинаковые адреса.
 *
 * `app/(customer)/(tabs)/object.tsx` и `app/(contractor)/(tabs)/object.tsx`
 * оба отвечают на `/object`: скобочные группы в URL не попадают. Внутри
 * приложения это незаметно — переходы идут через `tabsRoute`, где префикс
 * группы задан явно. Но по прямому адресу — ссылка из пуша, перезагрузка
 * страницы, кнопка «назад» в браузере — выбирает роутер, и заказчик открывает
 * экран исполнителя.
 *
 * Последствия не косметические: на экране «Данные» заказчик получает подсказку
 * для исполнителя и теряет собственные права — `canEditProjectProfile` и
 * управление технадзором считаются по роли группы, а не по роли человека.
 */
export type RoleGroup = 'customer' | 'contractor';

/** Префикс группы маршрутов; совпадает с `tabsPrefix` из osSections. */
export function roleGroupPrefix(role: RoleGroup): string {
  return role === 'customer' ? '/(customer)/(tabs)' : '/(contractor)/(tabs)';
}

/**
 * Куда перенаправить, если открытая группа не совпадает с ролью пользователя.
 * `null` — перенаправлять не нужно.
 *
 * Корень вкладок пропускаем: на первом кадре после перезагрузки страницы путь
 * успевает побыть `/`, и перенаправление в этот момент уносило бы с экрана, на
 * который вела ссылка, на главную. Саму главную по роли разводит `app/index`,
 * поэтому пропуск ничего не теряет.
 */
export function roleGroupRedirectPath(
  groupRole: RoleGroup,
  userRole: string | null | undefined,
  pathname: string,
): string | null {
  if (!userRole) return null;
  const actual: RoleGroup = userRole === 'contractor' ? 'contractor' : 'customer';
  if (actual === groupRole) return null;
  if (!pathname || pathname === '/') return null;
  // `usePathname` отдаёт адрес без групп: `/object`, `/budget`, `/object/plan`.
  return `${roleGroupPrefix(actual)}${pathname}`;
}
