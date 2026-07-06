/** Чистая логика лимита заказчика — без API */
export function normalizeCustomerBudget(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
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
