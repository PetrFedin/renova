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
  total: number;
  label: string;
};

export function buildPortalPendingSummary(snapshot: PortalSnapshotLike): PortalPendingSummary {
  const acceptances = snapshot.pending_acceptances?.length ?? 0;
  const payments = snapshot.pending_payments?.length ?? 0;
  const documents = snapshot.pending_draft_documents?.length ?? 0;
  const total = acceptances + payments + documents;
  const parts = [
    acceptances > 0 ? `приёмка ${acceptances}` : null,
    payments > 0 ? `оплата ${payments}` : null,
    documents > 0 ? `подпись ${documents}` : null,
  ].filter((value): value is string => Boolean(value));

  return {
    acceptances,
    payments,
    documents,
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
