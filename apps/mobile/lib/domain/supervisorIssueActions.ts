/**
 * Технадзор ведёт замечания: проверяет исправление и закрывает либо возвращает.
 * Зеркало backend `SUPERVISOR_ISSUE_TRANSITIONS`: исполнительные переходы
 * (начать, «исправлено») технадзору недоступны.
 */
export type SupervisorIssueAction = {
  target: 'closed' | 'open';
  label: string;
  confirmTitle: string;
  confirmMessage: string;
  destructive?: boolean;
};

export const SUPERVISOR_ISSUE_STATUS_LABEL: Record<string, string> = {
  open: 'Открыто',
  assigned: 'Назначено',
  in_progress: 'В работе',
  fixed: 'Исправлено — ждёт проверки',
  review: 'На проверке',
  closed: 'Закрыто',
  rejected: 'Отклонено',
};

const CLOSE: SupervisorIssueAction = {
  target: 'closed',
  label: 'Исправление принято — закрыть',
  confirmTitle: 'Закрыть замечание?',
  confirmMessage: 'Вы подтверждаете, что исправление проверено. Заказчик и исполнитель получат уведомление.',
};
const RETURN: SupervisorIssueAction = {
  target: 'open',
  label: 'Не исправлено — вернуть в открытые',
  confirmTitle: 'Вернуть замечание в открытые?',
  confirmMessage: 'Исполнитель увидит, что исправление не принято, и доработает.',
  destructive: true,
};
const REOPEN: SupervisorIssueAction = {
  target: 'open',
  label: 'Открыть снова',
  confirmTitle: 'Открыть замечание снова?',
  confirmMessage: 'Закрытое замечание вернётся в работу исполнителю.',
  destructive: true,
};

/** Гарантийные обращения закрываются отдельным гарантийным контуром. */
export function isWarrantyIssue(issue: { title?: string | null }): boolean {
  return (issue.title || '').startsWith('[Гарантия]');
}

export function supervisorIssueActions(
  issue: { status: string; title?: string | null },
  input: { isSupervisor: boolean; capabilities: readonly string[] },
): SupervisorIssueAction[] {
  if (!input.isSupervisor || !input.capabilities.includes('quality_review')) return [];
  if (isWarrantyIssue(issue)) return [];
  switch (issue.status) {
    case 'fixed':
    case 'review':
      return [CLOSE, RETURN];
    case 'closed':
      return [REOPEN];
    default:
      return [];
  }
}

export const SEVERITY_CHOICES = [
  { value: 'low', label: 'Низкая' },
  { value: 'medium', label: 'Средняя' },
  { value: 'high', label: 'Высокая' },
  { value: 'critical', label: 'Критичная' },
] as const;

/** Новое замечание: нужен этап и описание; критичные и высокие блокируют приёмку этапа. */
export function validateSupervisorRemark(input: { stageId: string | null; description: string }):
  | { ok: true; description: string }
  | { ok: false; message: string } {
  if (!input.stageId) return { ok: false, message: 'Выберите этап, к которому относится замечание.' };
  const description = input.description.trim();
  if (description.length < 3) return { ok: false, message: 'Опишите, что именно не так.' };
  return { ok: true, description };
}
