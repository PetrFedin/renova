/** Read-only focus for a resource already returned by a project-scoped API. */
export function targetFirst<T extends { id: string }>(items: readonly T[], targetId?: string): T[] {
  if (!targetId) return [...items];
  const index = items.findIndex((item) => item.id === targetId);
  if (index <= 0) return [...items];
  return [items[index], ...items.slice(0, index), ...items.slice(index + 1)];
}

export type PaymentTarget<T> =
  | { kind: 'none' | 'waiting' | 'missing'; payment: null }
  | { kind: 'found'; payment: T };

/**
 * An explicit payment ID never falls back to the first pending payment.
 * While data is loading (or has errored) a missing resource is not inferred.
 */
export function resolvePaymentTarget<T extends { id: string; status: string }>(
  payments: readonly T[],
  paymentId: string | undefined,
  legacyOpen: string | undefined,
  loaded: boolean,
): PaymentTarget<T> {
  const hasId = paymentId !== undefined && paymentId.length > 0;
  const requestedLegacy = legacyOpen === '1' || legacyOpen === 'true';
  if (!hasId && !requestedLegacy) return { kind: 'none', payment: null };
  if (!loaded) return { kind: 'waiting', payment: null };
  if (hasId) {
    const selected = payments.find((payment) => payment.id === paymentId);
    return selected ? { kind: 'found', payment: selected } : { kind: 'missing', payment: null };
  }
  const pending = payments.find((payment) => payment.status === 'pending');
  return pending ? { kind: 'found', payment: pending } : { kind: 'none', payment: null };
}
