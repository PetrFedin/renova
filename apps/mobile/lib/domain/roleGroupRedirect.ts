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
 * Корень вкладок здесь пропускается намеренно: на первом кадре после
 * перезагрузки путь успевает побыть `/`, и перенаправление в этот момент
 * унесло бы с экрана, на который вела ссылка, на главную. Для самого корня
 * есть `roleGroupRootRedirectPath` — он применяется после монтирования,
 * когда путь уже установился.
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

/**
 * Корень вкладок: `/` отвечает и за `(customer)/(tabs)/index`, и за
 * `(contractor)/(tabs)/index`. Роутер выбирает группу сам, и заказчик после
 * перезагрузки открывает главную исполнителя — с «Заявками и новыми
 * объектами», чужим доком и чужими правами.
 *
 * Расчёт на то, что «главную по роли разводит `app/index`», не оправдался:
 * `app/index.tsx` отвечает на тот же адрес `/`, и когда роутер выбирает
 * групповой экран, редирект из `app/index` не выполняется вовсе.
 *
 * Возвращает адрес корня нужной группы. Применять его нужно после
 * монтирования, а не в первом кадре — иначе вернётся та же ловушка с
 * неустановившимся путём.
 */
export function roleGroupRootRedirectPath(
  groupRole: RoleGroup,
  userRole: string | null | undefined,
  pathname: string,
): string | null {
  if (!userRole) return null;
  const actual: RoleGroup = userRole === 'contractor' ? 'contractor' : 'customer';
  if (actual === groupRole) return null;
  if (pathname !== '/') return null;
  return `${roleGroupPrefix(actual)}/`;
}

/**
 * Куда отправить человека без сессии.
 *
 * Адрес `/` обслуживают и `app/index.tsx`, и групповые `(customer)/(tabs)/index`
 * с `(contractor)/(tabs)/index`. Роутер выбирает групповой, поэтому редирект
 * из `app/index.tsx` — единственное место, где проверялось «пользователя нет», —
 * не выполняется вовсе. Человек без аккаунта видел главную заказчика с надписью
 * «Нет данных проекта» и кнопкой «Загрузить демо»: ни войти, ни
 * зарегистрироваться с этого экрана нельзя.
 *
 * Пока сессия восстанавливается, не трогаем: `loading` снимается уже после
 * попытки поднять сохранённую сессию, в том числе из снимка без связи с
 * сервером. Уводим только когда точно известно, что сессии нет.
 */
export function signedOutRedirectPath(
  userRole: string | null | undefined,
  loading: boolean,
): string | null {
  if (loading) return null;
  if (userRole) return null;
  return '/onboarding/role';
}
