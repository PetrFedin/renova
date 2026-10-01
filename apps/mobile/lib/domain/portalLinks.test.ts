import { portalLinkRowLabel, portalLinkScopeLabel } from './portalLinks';

const must = (c: boolean, m: string) => {
  if (!c) throw new Error(m);
};
must(portalLinkScopeLabel(['read']) === 'только просмотр', 'read only');
must(portalLinkScopeLabel(['read', 'accept_stage', 'sign_document', 'pay']) === 'приёмка и подпись · оплата', 'full scopes');
must(portalLinkRowLabel({ id: '1', scopes: ['read'], created_at: '2026-10-05T10:00:00', expires_at: null }) === 'только просмотр · выдана 05.10', 'row label');
must(portalLinkRowLabel({ id: '1', scopes: ['read'], created_at: null, expires_at: null }) === 'только просмотр', 'no date');
console.log('portalLinks ok');
