/** Чистая логика лимита заказчика — без API */
export function normalizeCustomerBudget(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

export type CustomerBudgetInputResult = {
  value: number | null;
  error: string | null;
};

/**
 * UI contract: empty input clears the limit; any non-empty input must be a
 * positive integer. Never reinterpret malformed/negative text as "clear".
 */
export function parseCustomerBudgetInput(input: string): CustomerBudgetInputResult {
  const compact = input.replace(/\s/g, '');
  if (!compact) return { value: null, error: null };
  if (!/^\d+$/.test(compact)) {
    return { value: null, error: 'Введите сумму цифрами или очистите поле.' };
  }
  const value = Number(compact);
  if (!Number.isSafeInteger(value) || value <= 0) {
    return { value: null, error: 'Бюджет должен быть больше 0 ₽ или поле должно быть пустым.' };
  }
  return { value, error: null };
}

/** Приоритет: сервер → локальный кэш */
export function resolveCustomerBudget(
  serverValue: unknown,
  localValue: number | null,
): number | null {
  const server = normalizeCustomerBudget(serverValue);
  if (server) return server;
  return localValue;
}
