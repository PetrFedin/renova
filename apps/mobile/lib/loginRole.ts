import type { UserRole } from '@/lib/api';

export const ROLE_LABEL: Record<UserRole, string> = {
  customer: 'Заказчик',
  contractor: 'Исполнитель',
};

export type LoginRoleResolution = {
  /** Роль, по которой ведём пользователя: всегда роль аккаунта с сервера. */
  role: UserRole;
  /** Не null, если выбранная на экране входа роль не совпала с ролью аккаунта. */
  mismatchMessage: string | null;
};

/**
 * ROLE-014: сервер для существующего аккаунта игнорирует выбранную роль,
 * поэтому навигация обязана идти по `user.role` из ответа сервера. Роль,
 * выбранная тумблером, нужна только для регистрации нового аккаунта.
 */
export function resolveLoginRole(selected: UserRole, actual: unknown): LoginRoleResolution {
  const role: UserRole = actual === 'contractor' || actual === 'customer' ? actual : selected;
  if (role === selected) return { role, mismatchMessage: null };
  return {
    role,
    mismatchMessage:
      `Этот аккаунт зарегистрирован как «${ROLE_LABEL[role]}», а выбрано «${ROLE_LABEL[selected]}». ` +
      `Открываем раздел «${ROLE_LABEL[role]}».`,
  };
}
