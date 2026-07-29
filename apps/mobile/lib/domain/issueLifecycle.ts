export type IssueStatus =
  | 'open'
  | 'assigned'
  | 'in_progress'
  | 'fixed'
  | 'review'
  | 'closed'
  | 'rejected';

export type IssueTransitionTarget = 'in_progress' | 'fixed' | 'closed' | 'open';
export type IssueActionIntent = 'primary' | 'secondary';

export type IssueTransitionAction = {
  target: IssueTransitionTarget;
  label: string;
  confirmTitle: string;
  intent: IssueActionIntent;
};

const KNOWN_STATUSES = new Set<IssueStatus>([
  'open',
  'assigned',
  'in_progress',
  'fixed',
  'review',
  'closed',
  'rejected',
]);

export function normalizeIssueStatus(value: string): IssueStatus | null {
  return KNOWN_STATUSES.has(value as IssueStatus) ? value as IssueStatus : null;
}

export function isIssueTransitionAllowed(
  from: IssueStatus,
  target: IssueTransitionTarget,
  role: 'customer' | 'contractor',
): boolean {
  if (role === 'contractor') {
    if (target === 'in_progress') return from === 'open' || from === 'assigned';
    if (target === 'fixed') return from === 'open' || from === 'assigned' || from === 'in_progress';
    return false;
  }
  if (target === 'closed') return from === 'fixed' || from === 'review';
  if (target === 'open') return from === 'fixed' || from === 'review' || from === 'closed';
  return false;
}

export function issueActions(
  statusValue: string,
  role: 'customer' | 'contractor',
  isWarranty = false,
): IssueTransitionAction[] {
  if (isWarranty) return [];
  const status = normalizeIssueStatus(statusValue);
  if (!status) return [];

  if (role === 'contractor') {
    const actions: IssueTransitionAction[] = [];
    if (isIssueTransitionAllowed(status, 'in_progress', role)) {
      actions.push({
        target: 'in_progress',
        label: 'В работу',
        confirmTitle: 'Начать исправление?',
        intent: 'secondary',
      });
    }
    if (isIssueTransitionAllowed(status, 'fixed', role)) {
      actions.push({
        target: 'fixed',
        label: 'Исправлено',
        confirmTitle: 'Отметить исправленным?',
        intent: 'primary',
      });
    }
    return actions;
  }

  if (isIssueTransitionAllowed(status, 'closed', role)) {
    return [
      {
        target: 'closed',
        label: 'Подтвердить исправление',
        confirmTitle: 'Подтвердить исправление?',
        intent: 'primary',
      },
      {
        target: 'open',
        label: 'Вернуть на доработку',
        confirmTitle: 'Вернуть на доработку?',
        intent: 'secondary',
      },
    ];
  }
  if (isIssueTransitionAllowed(status, 'open', role)) {
    return [{
      target: 'open',
      label: 'Открыть снова',
      confirmTitle: 'Открыть замечание снова?',
      intent: 'secondary',
    }];
  }
  return [];
}

export function issueWaitingHint(
  statusValue: string,
  role: 'customer' | 'contractor',
  isWarranty = false,
): string | null {
  if (isWarranty) return role === 'contractor' ? 'Гарантию закрывает заказчик' : null;
  const status = normalizeIssueStatus(statusValue);
  if (!status) return null;
  if (role === 'customer' && (status === 'open' || status === 'assigned' || status === 'in_progress')) {
    return 'Ждёт исправления исполнителем';
  }
  if (role === 'contractor' && (status === 'fixed' || status === 'review')) {
    return 'Ждёт подтверждения заказчика';
  }
  return null;
}
