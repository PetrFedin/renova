/**
 * SCR-002: внутренний путь приложения против «открытого перенаправления».
 *
 * `returnTo` и ссылки пуша попадают в `router.replace`; expo-router для внешнего адреса
 * (`https://…`, `//host`, `javascript:…`) открывает его системой. Принимаем только пути,
 * начинающиеся с одного «/».
 */

/** Явно внешняя или опасная цель: схема, «//host», обратная косая, управляющие символы. */
export function isUnsafeNavTarget(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(v)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return true;
  if (/^[/\\]{2}/.test(v) || v.startsWith('\\')) return true;
  return false;
}

/** `returnTo`: только внутренний путь вида `/…`; иначе undefined (вызывающий вернёт на главную). */
export function sanitizeReturnTo<T extends string | null | undefined>(value: T): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  if (v.length < 1 || !v.startsWith('/')) return undefined;
  if (isUnsafeNavTarget(v)) return undefined;
  return v;
}
