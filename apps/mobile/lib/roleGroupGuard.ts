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
