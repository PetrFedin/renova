/** Фаза проекта в списке объектов — picker, портфель */
import type { ProjectSummary } from '@/lib/api';
import { formatPaymentsDue } from '../i18n/ruCountLabels';

export function formatProjectPhaseLabel(p: ProjectSummary, pendingPayments?: number | null): string {
  if (p.progress_percent < 100) return 'В работе';
  const pending = pendingPayments ?? p.pending_payments;
  if (pending != null && pending > 0) {
    // 11/21 оплат — через Intl, не «=== 1 / иначе оплат»
    return `Закрытие · ${formatPaymentsDue(pending)}`;
  }
  if (pending === 0) return 'Завершён';
  return 'Закрытие';
}
