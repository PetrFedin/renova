/**
 * Действия над замечанием в разделе «Приёмка» (REP-07, REP-08, REP-19).
 *
 * Граф статусов зеркалит backend (`services/issue_service.py`): заказчик закрывает
 * только исправленное (`fixed`/`review`) или, если исполнителя в проекте нет,
 * закрывает сам; исполнитель отмечает исправление из `open/assigned/in_progress`.
 * Кнопки, которых сервер всё равно отвергнет (раньше — 404/409), не показываем.
 */

export type IssueAction = {
  key: 'confirm' | 'reopen' | 'close';
  next: 'closed' | 'open';
  label: string;
  /** подтверждение перед действием */
  confirmTitle: string;
  confirmPrimary: string;
};

const AWAITING_CUSTOMER = new Set(['fixed', 'review']);
const OPEN_FOR_EXECUTOR = new Set(['open', 'assigned', 'in_progress']);

export function customerIssueActions(status: string, selfManaged: boolean): IssueAction[] {
  if (AWAITING_CUSTOMER.has(status)) {
    return [
      { key: 'confirm', next: 'closed', label: 'Подтвердить исправление', confirmTitle: 'Подтвердить исправление?', confirmPrimary: 'Подтвердить' },
      { key: 'reopen', next: 'open', label: 'Вернуть на доработку', confirmTitle: 'Вернуть замечание исполнителю?', confirmPrimary: 'Вернуть' },
    ];
  }
  if (selfManaged && OPEN_FOR_EXECUTOR.has(status)) {
    return [{ key: 'close', next: 'closed', label: 'Закрыть', confirmTitle: 'Закрыть замечание?', confirmPrimary: 'Закрыть' }];
  }
  return [];
}

/** Исполнитель может отметить исправление только у ещё не исправленного замечания. */
export function contractorCanMarkFixed(status: string, title: string): boolean {
  if ((title || '').startsWith('[Гарантия]')) return false;
  return OPEN_FOR_EXECUTOR.has(status);
}

/** Подпись для заказчика там, где у него нет хода. */
export function customerIssueWaitingHint(status: string, selfManaged: boolean): string | null {
  if (customerIssueActions(status, selfManaged).length) return null;
  if (OPEN_FOR_EXECUTOR.has(status)) return 'Ждём, когда исполнитель отметит исправление';
  return null;
}

type IssueLike = { status: string; severity: string };

/** Единый расчёт сводки для обеих ролей: только открытые замечания, подписи фиксированы. */
export function controlSummary(issues: IssueLike[], pendingAcceptance: number) {
  const open = issues.filter((i) => i.status !== 'closed');
  return {
    pendingAcceptance,
    openIssues: open.length,
    criticalOpen: open.filter((i) => i.severity === 'critical' || i.severity === 'high').length,
  };
}
