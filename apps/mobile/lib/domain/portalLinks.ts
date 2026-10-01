/** INB-04: подписи активных портал-ссылок в UI отзыва. */
export type PortalLinkRow = { id: string; scopes: string[]; created_at: string | null; expires_at: string | null };

export function portalLinkScopeLabel(scopes: string[]): string {
  const parts = [
    scopes.includes('accept_stage') || scopes.includes('sign_document') ? 'приёмка и подпись' : null,
    scopes.includes('pay') ? 'оплата' : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'только просмотр';
}

export function portalLinkRowLabel(row: PortalLinkRow): string {
  const created = row.created_at ? new Date(row.created_at) : null;
  const when = created && !Number.isNaN(created.getTime())
    ? `${String(created.getDate()).padStart(2, '0')}.${String(created.getMonth() + 1).padStart(2, '0')}`
    : '';
  return `${portalLinkScopeLabel(row.scopes)}${when ? ` · выдана ${when}` : ''}`;
}
