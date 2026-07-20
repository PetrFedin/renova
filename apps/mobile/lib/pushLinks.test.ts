/** Smoke-тест deep links — npx tsx lib/pushLinks.test.ts */
import { resolvePushLink, resolveLegacyTabHref, resolveNotificationLink } from './pushLinks';

const stage = resolvePushLink('/stage/abc-123', '/(customer)/(tabs)/');
console.assert(stage?.pathname === '/stage/[id]' && stage.params.id === 'abc-123', 'stage');

const chat = resolvePushLink('/chat/thread-1', '/chat');
console.assert(chat?.pathname === '/chat/[threadId]', 'chat');

console.assert(resolvePushLink('/approvals', '/home')?.pathname === '/approvals', 'approvals');
console.assert(resolvePushLink('/conflicts', '/home')?.pathname === '/conflicts', 'conflicts');
console.assert(resolvePushLink('/(customer)/(tabs)/finance', '/home')?.pathname.includes('budget'), 'finance → budget');
console.assert(resolveLegacyTabHref('/(contractor)/(tabs)/money').pathname.includes('budget'), 'legacy money');
console.assert(resolvePushLink('/(contractor)/(tabs)/plan', '/home')?.params?.tab === 'plan', 'plan tab param');
console.assert(resolvePushLink('/(customer)/(tabs)/calendar', '/home')?.pathname.includes('calendar'), 'calendar standalone route');

console.assert(resolvePushLink('/scratchpad', '/home')?.pathname === '/scratchpad', 'scratchpad stack');
console.assert(resolvePushLink('/scratchpad', '/home')?.params?.returnTo === '/home', 'scratchpad returnTo');
console.assert(resolvePushLink(null) === null, 'null');

const payCustomer = resolveNotificationLink('payment_pending', 'customer');
console.assert(payCustomer?.pathname.includes('budget') && payCustomer.params.tab === 'payments', 'notify payment customer');
const payContractor = resolveNotificationLink('payment_pending', 'contractor');
console.assert(payContractor?.pathname.includes('(contractor)'), 'notify payment contractor');
const confirmedCustomer = resolveNotificationLink('payment_confirmed', 'customer');
console.assert(confirmedCustomer?.pathname.includes('budget') && confirmedCustomer.params.tab === 'payments', 'notify payment confirmed customer');
const confirmedContractor = resolveNotificationLink('payment_confirmed', 'contractor');
console.assert(confirmedContractor?.pathname.includes('(contractor)'), 'notify payment confirmed contractor');
console.assert(resolvePushLink('/finance-center', '/home', 'customer')?.params?.tab === 'payments', 'finance-center redirect');
console.assert(resolvePushLink('/work-schedule', '/home', 'customer')?.pathname.includes('calendar'), 'work-schedule redirect');
console.assert(resolvePushLink('/control', '/home', 'customer')?.pathname === '/(customer)/(tabs)/repair', 'control redirect customer');
console.assert(resolvePushLink('/control', '/home', 'customer')?.params?.tab === 'control', 'control tab customer');
console.assert(resolvePushLink('/control', '/home', 'contractor')?.pathname === '/(contractor)/(tabs)/repair', 'control redirect contractor');
console.assert(resolvePushLink('/control', '/home', 'contractor')?.params?.tab === 'control', 'control tab contractor');
console.assert(resolveNotificationLink('stage_review')?.pathname === '/(customer)/(tabs)/repair', 'notify acceptance');
console.assert(resolveNotificationLink('stage_review')?.params?.tab === 'control', 'notify acceptance tab');
console.assert(resolveNotificationLink('change_order')?.params?.estimateLayer === 'changes', 'change_order → estimate changes');
console.assert(resolveNotificationLink('change_order', 'contractor')?.pathname.includes('object'), 'change_order contractor → object estimate');
const unknownNotify = resolveNotificationLink('unknown_xyz');
console.assert(unknownNotify?.pathname === '/inbox', 'notify unknown → inbox');
// W66 #25: smoke deep-links for contract / QC / schedule notify
console.assert(resolvePushLink('/documents', '/home', 'customer')?.pathname === '/documents', 'documents');
console.assert(resolvePushLink('/quality-control', '/home', 'customer')?.pathname === '/quality-control', 'qc');
console.assert(resolveNotificationLink('schedule_review', 'customer')?.pathname.includes('calendar'), 'schedule_review customer');
console.assert(resolveNotificationLink('document', 'contractor')?.pathname === '/documents', 'document notify');
console.log('pushLinks: OK');


console.assert(resolveNotificationLink('issue', 'contractor')?.pathname === '/quality-control', 'issue notify');
console.assert(resolveNotificationLink('payment_pending', 'contractor')?.pathname.includes('contractor'), 'contractor budget');
console.assert(resolvePushLink('/notifications', '/home', 'customer')?.pathname === '/inbox', 'notifications → inbox');

console.assert(resolveLegacyTabHref('/(customer)/(tabs)/control').pathname === '/(customer)/(tabs)/repair', 'legacy control customer');
console.assert(resolveLegacyTabHref('/(customer)/(tabs)/control').params?.tab === 'control', 'legacy control tab customer');
console.assert(resolveLegacyTabHref('/(contractor)/(tabs)/control').pathname === '/(contractor)/(tabs)/repair', 'legacy control contractor');
console.assert(resolveLegacyTabHref('/(contractor)/(tabs)/control').params?.tab === 'control', 'legacy control tab');
