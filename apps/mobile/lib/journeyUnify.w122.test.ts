/** W122: Houzz/BT client portal share + accept→pay/sign chain */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const repo = join(mobile, '../..');

const panel = readFileSync(join(mobile, 'components/renova/PortalSharePanel.tsx'), 'utf8');
const cust = readFileSync(join(mobile, 'components/screens/profile/CustomerProfileScreen.tsx'), 'utf8');
const contr = readFileSync(join(mobile, 'components/screens/profile/ContractorProfileScreen.tsx'), 'utf8');
const docs = readFileSync(join(mobile, 'components/renova/DocumentsHub.tsx'), 'utf8');
const portalUi = readFileSync(join(mobile, 'app/portal.tsx'), 'utf8');
const portalApi = readFileSync(join(repo, 'backend/app/api/v1/portal.py'), 'utf8');

console.assert(panel.includes('createCustomerPortalLink') && panel.includes('allow_accept') && panel.includes('allow_pay'), 'share panel scopes');
console.assert(cust.includes('PortalSharePanel') && cust.includes('Клиентский портал'), 'customer profile share');
console.assert(contr.includes('PortalSharePanel') && contr.includes('activeProject'), 'contractor profile share');
console.assert(docs.includes("id: 'portal'") && docs.includes('createCustomerPortalLink'), 'docs hub portal row');
console.assert(portalApi.includes('portal_link_customer_or_contractor_only') || portalApi.includes('proj.contractor_id'), 'API contractor mint');
console.assert(portalApi.includes('target_user_id = proj.customer_id'), 'API link for customer');
console.assert(portalUi.includes('goPayments') && portalUi.includes('const next = await refreshPortalSnapshot'), 'portal accept→pay');
console.assert(portalUi.includes('К оплате') && portalUi.includes('focusCard'), 'portal focus payments');
console.assert(portalUi.includes('useRef<ScrollView>(null)'), 'portal scroll ref ok');

console.log('journeyUnify.w122.test.ts OK');
