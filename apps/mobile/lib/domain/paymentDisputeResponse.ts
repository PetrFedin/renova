/**
 * JRN-020: ответ исполнителя на спор заказчика по платежу.
 * Ответ статус платежа не меняет — он хранится событием в истории платежа
 * (evidence_type contractor_dispute_*), его видят обе стороны.
 */
export type DisputeResponseKind = 'comment' | 'agree' | 'contest';

export const DISPUTE_RESPONSE_EVIDENCE: Record<DisputeResponseKind, string> = {
  comment: 'contractor_dispute_comment',
  agree: 'contractor_dispute_agree',
  contest: 'contractor_dispute_contest',
};

export const DISPUTE_RESPONSE_TITLE: Record<DisputeResponseKind, string> = {
  agree: 'Исполнитель согласен вернуть оплату',
  contest: 'Исполнитель не согласен со спором',
  comment: 'Исполнитель оставил комментарий к спору',
};

export const DISPUTE_RESPONSE_MIN_LENGTH = 10;

type EventLike = { id?: string; evidence_type?: string | null; note?: string | null; created_at: string };

export function disputeResponseKindOf(evidenceType: string | null | undefined): DisputeResponseKind | null {
  for (const kind of Object.keys(DISPUTE_RESPONSE_EVIDENCE) as DisputeResponseKind[]) {
    if (DISPUTE_RESPONSE_EVIDENCE[kind] === evidenceType) return kind;
  }
  return null;
}

/** Кнопка «Ответить на спор»: только ведущий исполнитель, спор открыт, не режим чтения. */
export function canRespondToDispute(input: {
  role: string;
  /** Роль в команде исполнителя: пусто или owner — ведущий; прораб/бригадир отвечать не могут. */
  teamRole?: string | null;
  readOnly?: boolean;
  status: string;
}): boolean {
  const lead = !input.teamRole || input.teamRole === 'owner';
  return input.role === 'contractor' && lead && !input.readOnly && input.status === 'disputed';
}

/** Последний ответ исполнителя на текущий (самый свежий) спор; null — ещё не отвечал. */
export function latestDisputeResponse(
  events: readonly EventLike[] | null | undefined,
): { kind: DisputeResponseKind; title: string; note: string; at: string } | null {
  const list = (events ?? []).map((event, index) => ({ event, index }));
  list.sort((a, b) => a.event.created_at.localeCompare(b.event.created_at) || a.index - b.index);
  let disputeAt = -1;
  list.forEach(({ event }, position) => {
    if (event.evidence_type === 'customer_dispute') disputeAt = position;
  });
  for (let position = list.length - 1; position > disputeAt; position -= 1) {
    const { event } = list[position];
    const kind = disputeResponseKindOf(event.evidence_type);
    if (kind) {
      return { kind, title: DISPUTE_RESPONSE_TITLE[kind], note: (event.note || '').trim(), at: event.created_at };
    }
  }
  return null;
}

export function validateDisputeResponseComment(comment: string): { ok: true; text: string } | { ok: false; message: string } {
  const text = comment.trim().replace(/\s+/g, ' ');
  if (text.length < DISPUTE_RESPONSE_MIN_LENGTH) {
    return { ok: false, message: `Напишите пояснение — минимум ${DISPUTE_RESPONSE_MIN_LENGTH} символов.` };
  }
  return { ok: true, text };
}
