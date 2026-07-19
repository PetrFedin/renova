/** Smoke: menu invariants — npx tsx lib/routeRegistry.test.ts */
import { assertRouteRegistryInvariants, menuRoutes, MAX_MORE_MENU_ITEMS, RENOVA_ROUTES, userFacingRouteIds } from './routeRegistry';
import { OS_MENU_SECTIONS, OS_MORE_UTIL_LINKS, MAX_HEADER_MORE_ITEMS } from '../constants/osSections';

assertRouteRegistryInvariants();

const moreCustomer = menuRoutes('customer', 'more');
if (moreCustomer.some((r) => r.id === 'finance-center' || r.id === 'work-schedule' || r.id === 'notifications')) {
  throw new Error('redirect-only routes must not appear in more menu');
}
/** Приёмка / QC / notifications — не в «Ещё» (канон: Ремонт / inbox) */
for (const id of ['work-acceptance', 'quality-control', 'notifications']) {
  if (moreCustomer.some((r) => r.id === id)) {
    throw new Error(`${id} must not appear in more menu`);
  }
}

if (!moreCustomer.some((r) => r.id === 'approvals')) {
  throw new Error('approvals must be in more menu (P0.4 lock/CO path)');
}
if (!moreCustomer.some((r) => r.id === 'inbox')) {
  throw new Error('inbox must be in more menu (attention SoT)');
}
if (moreCustomer.length > MAX_MORE_MENU_ITEMS) {
  throw new Error(`Home more menu exceeds ${MAX_MORE_MENU_ITEMS}`);
}

const headerMoreCount =
  OS_MENU_SECTIONS.customer.length + OS_MORE_UTIL_LINKS.length;
if (headerMoreCount > MAX_HEADER_MORE_ITEMS) {
  throw new Error(`Header «Ещё» exceeds ${MAX_HEADER_MORE_ITEMS}: ${headerMoreCount}`);
}

const wa = RENOVA_ROUTES.find((r) => r.id === 'work-acceptance');
if (wa?.visibility !== 'deeplink') throw new Error('work-acceptance must be deeplink');

const notif = RENOVA_ROUTES.find((r) => r.id === 'notifications');
if (notif?.redirectTo !== '/inbox') throw new Error('notifications must redirect to /inbox');

const guestMore = menuRoutes('customer', 'more', { readOnly: true });
const guestIds = new Set(guestMore.map((r) => r.id));
for (const id of ['documents', 'inbox']) {
  if (!guestIds.has(id)) throw new Error(`readOnly guest must see ${id}`);
}
if (guestIds.has('quality-control') || guestIds.has('notifications')) {
  throw new Error('readOnly guest must not see QC/notifications dead ends');
}
if (guestMore.length > 3) throw new Error('readOnly more menu too large');

const uf = userFacingRouteIds();
if (uf.length > 40) {
  throw new Error(`user-facing routes exceed 40 (P2.7 IA): ${uf.length}`);
}
if (!uf.includes('approvals')) {
  throw new Error('approvals must be user-facing');
}

console.log('routeRegistry.test OK', { more: moreCustomer.map((r) => r.id), userFacing: uf.length });

