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
console.assert(resolveNotificationLink('payment_pending')?.pathname === '/finance-center', 'notify payment');
console.assert(resolveNotificationLink('stage_review')?.pathname === '/work-acceptance', 'notify acceptance');
console.assert(resolveNotificationLink('unknown_xyz') === null, 'notify unknown');
console.log('pushLinks: OK');
