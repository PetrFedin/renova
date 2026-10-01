/**
 * HOM-20 / SCR-006: группа маршрутов `(customer)` / `(contractor)` открывается только
 * вошедшему пользователю с этой ролью. Раньше роль экрана бралась из группы, поэтому
 * глубокая ссылка без сессии давала вкладки без содержимого, а чужая роль — чужой интерфейс.
 */
export type RoleGroup = 'customer' | 'contractor';

export type RoleGroupDecision =
  | { kind: 'wait' }
  | { kind: 'allow' }
  | { kind: 'login' }
  | { kind: 'redirect'; to: RoleGroup };

export function decideRoleGroupAccess(
  group: RoleGroup,
  state: { loading: boolean; userRole?: string | null; hasUser: boolean },
): RoleGroupDecision {
  if (state.loading) return { kind: 'wait' };
  if (!state.hasUser) return { kind: 'login' };
  const own: RoleGroup = state.userRole === 'contractor' ? 'contractor' : 'customer';
  return own === group ? { kind: 'allow' } : { kind: 'redirect', to: own };
}

/** Вкладки, которые есть в обеих группах и потому имеют один и тот же URL. */
const SHARED_TAB_SEGMENTS = new Set(['object', 'repair', 'budget', 'calendar', 'chat', 'profile']);

/**
 * Группы `(customer)` и `(contractor)` прозрачны в URL, поэтому `/profile` или
 * `/object?tab=estimate` одинаково подходят обеим, а expo-router при холодной
 * загрузке выбирает первую (contractor). Когда страж обнаруживает, что выбрана
 * чужая группа, он обязан открыть ТУ ЖЕ вкладку в своей группе, а не главную.
 * Возвращает имя вкладки (`index` для главной и для всего неизвестного).
 */
export function sharedTabSegment(pathname: string): string {
  const parts = pathname.split('?')[0].split('/').filter((x) => x && !/^\(.*\)$/.test(x));
  const seg = parts.length === 1 ? parts[0] : '';
  return SHARED_TAB_SEGMENTS.has(seg) ? seg : 'index';
}

/** Только строковые параметры без служебных (`screen`, `params`) — для повторного открытия. */
export function carryParams(params: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (k === 'screen' || k === 'params' || k === 'legacyTab' || k === 'tool' || k === 'slug') continue;
    const val = Array.isArray(v) ? v[0] : v;
    if (typeof val === 'string' && val !== '') out[k] = val;
  }
  return out;
}
