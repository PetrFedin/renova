import { DOCK_DEFAULT, DOCK_PRESET_SETUP, DOCK_MAX } from '@/constants/dockBar';
import { RENOVA_ROUTES, assertRouteRegistryInvariants } from '@/lib/routeRegistry';
import {
  activeDockItemId,
  buildSecondaryNavigation,
  getBudgetHubLabel,
  resolveRegistryRedirect,
  warrantyRoute,
} from './navigationPolicy';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assertRouteRegistryInvariants();
assert(DOCK_MAX === 5, 'dock max is five');
const dockContract = RENOVA_ROUTES.filter((route) => route.visibility === 'dock');
assert(dockContract.length === 5 && dockContract.some((route) => route.id === 'chat'), 'mandatory Chat in registry dock');
assert(getBudgetHubLabel('customer') === 'Деньги', 'customer money label');
assert(getBudgetHubLabel('contractor') === 'Бюджет', 'contractor budget label');

for (const role of ['customer', 'contractor'] as const) {
  const setupCases = [
    [{ pathname: `/${role}/object`, params: { tab: 'rooms' } }, 'object'],
    [{ pathname: `/${role}/object`, params: { tab: 'plan' } }, 'object'],
    [{ pathname: `/${role}/object`, params: { tab: 'estimate' } }, 'estimate'],
    [{ pathname: `/${role}/estimate`, params: { tab: 'estimate' } }, 'estimate'],
  ] as const;
  for (const [state, expected] of setupCases) {
    const active = DOCK_PRESET_SETUP.filter((id) => activeDockItemId(DOCK_PRESET_SETUP, state) === id);
    assert(active.length <= 1, `${role}: never two active dock items`);
    assert(active[0] === expected, `${role}: ${expected} active`);
  }
}

for (const role of ['customer', 'contractor'] as const) {
  const guestHeader = buildSecondaryNavigation({ role, readOnly: true, guest: true, dockItems: DOCK_DEFAULT, surface: 'header' });
  const guestHome = buildSecondaryNavigation({ role, readOnly: true, guest: true, dockItems: DOCK_DEFAULT, surface: 'home' });
  for (const list of [guestHeader, guestHome]) {
    assert(list.map((route) => route.id).join(',') === 'documents,inbox', `${role}: guest Documents + Inbox only`);
  }
  const headerDefault = buildSecondaryNavigation({ role, dockItems: DOCK_DEFAULT, surface: 'header' });
  assert(headerDefault.some((route) => route.id === 'calendar'), `${role}: Calendar in header when absent from dock`);
  const headerWithCalendar = buildSecondaryNavigation({ role, dockItems: [...DOCK_DEFAULT.slice(0, 4), 'calendar'], surface: 'header' });
  assert(!headerWithCalendar.some((route) => route.id === 'calendar'), `${role}: Calendar deduped by canonical id`);
  const authenticatedHome = buildSecondaryNavigation({
    role,
    dockItems: DOCK_DEFAULT,
    surface: 'home',
    excludeRouteIds: headerDefault.map((route) => route.id),
  });
  assert(authenticatedHome.every((route) => !headerDefault.some((headerRoute) => headerRoute.id === route.id)), `${role}: no authenticated duplicate`);
  const discoverable = new Set([...headerDefault, ...authenticatedHome].map((route) => route.id));
  assert(discoverable.has('documents') && discoverable.has('inbox'), `${role}: utilities retain an alternative entry`);
  if (role === 'contractor') {
    assert(![...headerDefault, ...authenticatedHome].some((route) => route.id === 'approvals'), 'contractor does not receive Approvals');
  }
}

const analyticsCustomer = resolveRegistryRedirect('project-analytics', 'customer');
const analyticsContractor = resolveRegistryRedirect('project-analytics', 'contractor');
assert(analyticsCustomer?.pathname.includes('(customer)'), 'analytics customer group');
assert(analyticsContractor?.pathname.includes('(contractor)'), 'analytics contractor group');
assert(analyticsContractor?.params?.tab === 'deviations', 'analytics tab preserved');

assert(warrantyRoute('customer', { claimId: 'c', issueId: 'i' }).pathname === '/documents', 'customer warranty documents');
assert(warrantyRoute('contractor', { claimId: 'c' }).pathname === '/quality-control', 'contractor warranty QC');

console.log('navigationPolicy.test OK');
