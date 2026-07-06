/** Фаза проекта в списке объектов — picker, портфель */
import type { ProjectSummary } from '@/lib/api';

export function formatProjectPhaseLabel(p: ProjectSummary, pendingPayments?: number | null): string {
  if (p.progress_percent < 100) return 'В работе';
  const pending = pendingPayments ?? p.pending_payments;
  if (pending != null && pending > 0) {
    return pending === 1 ? 'Закрытие · 1 оплата' : `Закрытие · ${pending} оплат`;
  }
  if (pending === 0) return 'Завершён';
  return 'Закрытие';
}
