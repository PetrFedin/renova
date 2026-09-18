export type PortalScope = 'pay' | 'accept_stage' | 'sign_document';

export type PortalSessionLike = {
  scopes?: readonly string[];
  read_only?: boolean;
};

export type PortalSnapshotLike = {
  read_only?: boolean;
  can_confirm_schedule?: boolean;
  can_accept_stage?: boolean;
  can_sign_documents?: boolean;
  can_decide_change_orders?: boolean;
  pending_acceptances?: readonly unknown[];
  pending_payments?: readonly unknown[];
  pending_draft_documents?: readonly unknown[];
  pending_work_schedule?: unknown;
  pending_change_orders?: readonly unknown[];
  estimate_summary?: { proposed_at?: string | null; locked_at?: string | null } | null;
};

export type PortalCapabilities = {
  readOnly: boolean;
  pay: boolean;
  accept: boolean;
  sign: boolean;
  confirmSchedule: boolean;
  acceptStage: boolean;
  signDocuments: boolean;
  decideChangeOrders: boolean;
};

function hasScope(session: PortalSessionLike, scope: PortalScope): boolean {
  return Boolean(session.scopes?.includes(scope));
}

export function buildPortalCapabilities(
  session: PortalSessionLike,
  snapshot: PortalSnapshotLike,
): PortalCapabilities {
  const readOnly = Boolean(session.read_only || snapshot.read_only);
  const pay = !readOnly && hasScope(session, 'pay');
  const accept = !readOnly && hasScope(session, 'accept_stage');
  const sign = !readOnly && hasScope(session, 'sign_document');

  return {
    readOnly,
    pay,
    accept,
    sign,
    confirmSchedule: accept && Boolean(snapshot.can_confirm_schedule),
    acceptStage: accept && Boolean(snapshot.can_accept_stage),
    signDocuments: sign && Boolean(snapshot.can_sign_documents),
    decideChangeOrders: accept && Boolean(snapshot.can_decide_change_orders),
  };
}

export type PortalPendingSummary = {
  acceptances: number;
  payments: number;
  documents: number;
  schedules: number;
  changeOrders: number;
  estimates: number;
  total: number;
  label: string;
};

/**
 * Решения, которые портал просит принять заказчика, в том порядке, в каком
 * они идут сверху вниз по экрану.
 *
 * Порядок здесь не выдуман: он повторяет порядок секций в `PortalScreen`.
 * Изобретать собственную «важность» было бы хуже — человек читает экран
 * сверху, и главным должно быть то, до чего он дойдёт первым.
 */
export type PortalDecision =
  | 'schedule'
  | 'acceptance'
  | 'changeOrder'
  | 'estimate'
  | 'payment'
  | 'document';

export const PORTAL_DECISION_ORDER: readonly PortalDecision[] = [
  'schedule',
  'acceptance',
  'changeOrder',
  'estimate',
  'payment',
  'document',
] as const;

/** Что именно ждёт решения. Ключ отсутствует или false — секции нет. */
export type PortalPendingDecisions = Partial<Record<PortalDecision, boolean>>;

/**
 * Первое решение сверху — оно и есть главное действие экрана.
 *
 * Портал показывал до пяти синих кнопок одновременно: «Согласовать график»,
 * «Принять этап», «Согласовать» (доп. работы), «Зафиксировать смету»,
 * «Подписать». Все одинаково выделенные, все равнозначные — и непонятно, с
 * чего начинать. Это первый экран, который видит новый заказчик.
 *
 * Ни одно действие не убрано: остальные становятся вторичными по виду и
 * остаются доступными.
 */
export function firstPortalDecision(
  pending: PortalPendingDecisions,
): PortalDecision | null {
  for (const decision of PORTAL_DECISION_ORDER) {
    if (pending[decision]) return decision;
  }
  return null;
}

/** Главное действие — сплошная кнопка, остальные — контурные. */
export function portalDecisionVariant(
  decision: PortalDecision,
  first: PortalDecision | null,
): 'primary' | 'outline' {
  return decision === first ? 'primary' : 'outline';
}

export function buildPortalPendingSummary(snapshot: PortalSnapshotLike): PortalPendingSummary {
  const acceptances = snapshot.pending_acceptances?.length ?? 0;
  const payments = snapshot.pending_payments?.length ?? 0;
  const documents = snapshot.pending_draft_documents?.length ?? 0;
  // График, доп. работы и смета тоже ждут решения заказчика, но в строку
  // «Сейчас: …» не попадали: человек читал «приёмка 2», а на экране его ждало
  // ещё три решения ниже.
  const schedules = snapshot.pending_work_schedule ? 1 : 0;
  const changeOrders = snapshot.pending_change_orders?.length ?? 0;
  const estimates = snapshot.estimate_summary?.proposed_at && !snapshot.estimate_summary?.locked_at ? 1 : 0;
  const total = acceptances + payments + documents + schedules + changeOrders + estimates;
  // Порядок частей — тот же, что порядок секций на экране.
  const parts = [
    schedules > 0 ? 'график' : null,
    acceptances > 0 ? `приёмка ${acceptances}` : null,
    changeOrders > 0 ? `доп. работы ${changeOrders}` : null,
    estimates > 0 ? 'смета' : null,
    payments > 0 ? `оплата ${payments}` : null,
    documents > 0 ? `подпись ${documents}` : null,
  ].filter((value): value is string => Boolean(value));

  return {
    acceptances,
    payments,
    documents,
    schedules,
    changeOrders,
    estimates,
    total,
    label: parts.length > 0 ? parts.join(' · ') : 'Нет срочных действий',
  };
}

export type PortalActionIntent = 'primary' | 'secondary' | 'destructive';

export function portalActionVariant(intent: PortalActionIntent):
  | 'primary'
  | 'outline'
  | 'dangerOutline' {
  if (intent === 'destructive') return 'dangerOutline';
  if (intent === 'secondary') return 'outline';
  return 'primary';
}

export function portalMutationKey(domain: string, id?: string | null): string {
  return id ? `${domain}:${id}` : domain;
}
