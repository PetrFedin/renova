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

/** Проект без исполнителя: заказчик сам и исправляет, и проверяет — замечание закрывается сразу. */
export type IssueActionContext = { selfManaged?: boolean };

export function isIssueTransitionAllowed(
  from: IssueStatus,
  target: IssueTransitionTarget,
  role: 'customer' | 'contractor',
  ctx: IssueActionContext = {},
): boolean {
  if (role === 'customer' && ctx.selfManaged && target === 'closed'
    && (from === 'open' || from === 'assigned' || from === 'in_progress')) return true;
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
  ctx: IssueActionContext = {},
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

  if (ctx.selfManaged && (status === 'open' || status === 'assigned' || status === 'in_progress')) {
    return [{
      target: 'closed',
      label: 'Закрыть замечание',
      confirmTitle: 'Закрыть замечание?',
      intent: 'primary',
    }];
  }
  if (isIssueTransitionAllowed(status, 'closed', role, ctx)) {
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
  ctx: IssueActionContext = {},
): string | null {
  if (isWarranty) return role === 'contractor' ? 'Гарантию закрывает заказчик' : null;
  const status = normalizeIssueStatus(statusValue);
  if (!status) return null;
  if (role === 'customer' && !ctx.selfManaged && (status === 'open' || status === 'assigned' || status === 'in_progress')) {
    return 'Ждёт исправления исполнителем';
  }
  if (role === 'contractor' && (status === 'fixed' || status === 'review')) {
    return 'Ждёт подтверждения заказчика';
  }
  return null;
}

/** Гарантийное обращение (QLT-004): исполнитель отвечает, заказчик закрывает или открывает снова. */
export type WarrantyActionKind = 'accept' | 'reject' | 'fixed' | 'close' | 'reopen';
export type WarrantyAction = {
  kind: WarrantyActionKind;
  label: string;
  intent: IssueActionIntent;
  /** Комментарий: 'required' — без него нельзя (отказ), 'optional' — по желанию, 'none' — не спрашиваем. */
  comment: 'required' | 'optional' | 'none';
};

export function warrantyActions(statusValue: string, role: 'customer' | 'contractor'): WarrantyAction[] {
  const status = normalizeIssueStatus(statusValue);
  if (!status) return [];
  if (role === 'contractor') {
    if (status === 'open') {
      return [
        { kind: 'accept', label: 'Принять в работу', intent: 'primary', comment: 'optional' },
        { kind: 'reject', label: 'Отклонить', intent: 'secondary', comment: 'required' },
      ];
    }
    if (status === 'in_progress') {
      return [
        { kind: 'fixed', label: 'Исправлено', intent: 'primary', comment: 'optional' },
        { kind: 'reject', label: 'Отклонить', intent: 'secondary', comment: 'required' },
      ];
    }
    return [];
  }
  if (status === 'closed') return [{ kind: 'reopen', label: 'Открыть снова', intent: 'secondary', comment: 'optional' }];
  if (status === 'rejected' || status === 'fixed') {
    return [
      { kind: 'close', label: 'Закрыть гарантию', intent: 'primary', comment: 'none' },
      { kind: 'reopen', label: 'Открыть снова', intent: 'secondary', comment: 'optional' },
    ];
  }
  return [{ kind: 'close', label: 'Закрыть гарантию', intent: 'primary', comment: 'none' }];
}

export function warrantyWaitingHint(statusValue: string, role: 'customer' | 'contractor'): string | null {
  const status = normalizeIssueStatus(statusValue);
  if (role === 'customer' && (status === 'open' || status === 'in_progress')) return 'Ждёт ответа исполнителя';
  if (role === 'contractor' && (status === 'fixed' || status === 'rejected')) return 'Ждёт решения заказчика';
  return null;
}
