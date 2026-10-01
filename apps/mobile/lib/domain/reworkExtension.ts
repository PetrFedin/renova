/**
 * STG-002: запрос исполнителя на продление срока доработки.
 *
 * Backend не хранит запрос отдельно («запрос не хранится»), но при каждом
 * решении пишет в обсуждение этапа запись. Поэтому «запрос ожидает» выводится
 * из комментариев этапа, которые уже приходят в StageDetail:
 *   исполнитель  — «Запрос продления срока доработки на N дн. — до ГГГГ-ММ-ДД»
 *   заказчик     — «Срок доработки продлён …» или «Продление срока доработки отклонено …»
 * Запрос ожидает, если он новее последнего решения заказчика и запрошенный срок
 * ещё не достигнут текущим сроком этапа.
 */
export type ReworkCommentLike = { text: string; author_role?: string | null; created_at?: string | null };

export type ReworkExtensionRequest = {
  days: number;
  /** Запрошенный срок, ГГГГ-ММ-ДД. */
  requestedDeadline: string;
};

const REQUEST_RE = /^Запрос продления срока доработки на (\d+) дн\. — до (\d{4}-\d{2}-\d{2})/;
const EXTENDED_PREFIX = 'Срок доработки продлён';
const DECLINED_PREFIX = 'Продление срока доработки отклонено';

/** Максимум вперёд от сегодняшнего дня, который разрешает backend. */
export const REWORK_SLA_MAX_AHEAD_DAYS = 14;

export function pendingReworkExtension(
  stage: { status?: string | null; needs_rework?: boolean | null; rework_deadline?: string | null },
  comments: readonly ReworkCommentLike[] | null | undefined,
): ReworkExtensionRequest | null {
  if (stage.status !== 'active' || stage.needs_rework !== true) return null;
  const list = comments ?? [];
  let requestIndex = -1;
  let request: ReworkExtensionRequest | null = null;
  let decisionIndex = -1;
  list.forEach((comment, index) => {
    const text = (comment.text || '').trim();
    if (comment.author_role === 'contractor') {
      const match = REQUEST_RE.exec(text);
      if (match) {
        requestIndex = index;
        request = { days: Number(match[1]), requestedDeadline: match[2] };
      }
    } else if (comment.author_role === 'customer') {
      if (text.startsWith(EXTENDED_PREFIX) || text.startsWith(DECLINED_PREFIX)) decisionIndex = index;
    }
  });
  if (!request || requestIndex < decisionIndex) return null;
  const current = (stage.rework_deadline || '').slice(0, 10);
  if (current && current >= (request as ReworkExtensionRequest).requestedDeadline) return null;
  return request;
}

export type ReworkExtensionView = 'customer_decide' | 'contractor_waiting' | null;

/** Кому что показывать: решает заказчик, исполнитель видит, что запрос ушёл. */
export function reworkExtensionView(input: {
  isContractor: boolean;
  canWrite: boolean;
  request: ReworkExtensionRequest | null;
}): ReworkExtensionView {
  if (!input.request) return null;
  if (input.isContractor) return 'contractor_waiting';
  return input.canWrite ? 'customer_decide' : null;
}

/** Новый срок так, как его считает backend: от большего из срока и «сейчас». */
export function extendedDeadline(currentDeadline: string | null | undefined, days: number, now: Date): Date {
  const parsed = currentDeadline ? new Date(currentDeadline) : null;
  const base = parsed && !Number.isNaN(parsed.getTime()) && parsed > now ? parsed : now;
  return new Date(base.getTime() + Math.max(1, Math.min(7, days)) * 86_400_000);
}

/** Продление упрётся в потолок backend (14 дней вперёд)? */
export function extensionExceedsLimit(currentDeadline: string | null | undefined, days: number, now: Date): boolean {
  return extendedDeadline(currentDeadline, days, now).getTime() > now.getTime() + REWORK_SLA_MAX_AHEAD_DAYS * 86_400_000;
}
