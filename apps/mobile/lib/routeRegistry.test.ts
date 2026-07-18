/** Smoke: menu invariants — npx tsx lib/routeRegistry.test.ts */
import { assertRouteRegistryInvariants, menuRoutes } from './routeRegistry';

assertRouteRegistryInvariants();

const moreCustomer = menuRoutes('customer', 'more');
if (moreCustomer.some((r) => r.id === 'finance-center' || r.id === 'work-schedule')) {
  throw new Error('redirect-only routes must not appear in more menu');
}

const guestMore = menuRoutes('customer', 'more', { readOnly: true });
const guestIds = new Set(guestMore.map((r) => r.id));
for (const id of ['documents', 'notifications']) {
  if (!guestIds.has(id)) throw new Error(`readOnly guest must see ${id}`);
}
if (guestMore.length > 4) throw new Error('readOnly more menu too large');

console.log('routeRegistry.test OK');
