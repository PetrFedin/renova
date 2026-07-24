import { DOCK_DEFAULT, DOCK_PRESET_SETUP } from '../../constants/dockBar';
import { buildAttentionBadgeState, resolveHeaderMoreBadge } from '../domain/headerChatBadges';
import { resolvePushLink } from '../pushLinks';
import { legacySlugRedirect } from '../resolveCatchAllSlug';
import { RENOVA_ROUTES } from '../routeRegistry';
import {
  activeDockItemId,
  buildSecondaryNavigation,
  navigationTargetHref,
  resolveRegistryRedirect,
  warrantyRoute,
} from './navigationPolicy';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// registry/policy -> typed redirect -> role-aware final target
const analytics = RENOVA_ROUTES.find((route) => route.id === 'project-analytics');
assert(analytics?.redirectTarget, 'project analytics is a typed registry redirect');
for (const role of ['customer', 'contractor'] as const) {
  const registryTarget = resolveRegistryRedirect(analytics.redirectTarget, role);
  const inboundTarget = resolvePushLink('/project-analytics?period=month', '/inbox', role);
  assert(registryTarget && registryTarget.pathname.includes(`(${role})`), `${role}: registry role group`);
  assert(inboundTarget?.pathname === registryTarget.pathname, `${role}: resolver converges on registry target`);
  assert(inboundTarget.params.tab === 'deviations', `${role}: analytics deviations`);
  assert(inboundTarget.params.period === 'month' && inboundTarget.params.returnTo === '/inbox', `${role}: analytics context`);
}

const materials = resolvePushLink('/repair?tab=materials&roomId=r%201', '/origin', 'customer');
assert(materials?.pathname === '/(customer)/(tabs)/repair', 'bare Repair becomes role-aware');
assert(materials.params.tab === 'materials' && materials.params.roomId === 'r 1', 'bare Repair decodes query');

const warrantyQuery = 'claimId=claim-1&issueId=issue-2&projectId=project-3&source=push&extra=kept';
for (const role of ['customer', 'contractor'] as const) {
  const expected = warrantyRoute(role);
  const push = resolvePushLink(`/warranty?${warrantyQuery}`, '/inbox', role);
  const legacy = legacySlugRedirect('warranty-claim', role);
  assert(push?.pathname === expected.pathname, `${role}: warranty push target`);
  assert(typeof legacy !== 'string' && legacy?.pathname === expected.pathname, `${role}: legacy warranty target`);
  for (const [key, value] of Object.entries({
    claimId: 'claim-1', issueId: 'issue-2', projectId: 'project-3', source: 'push', extra: 'kept', returnTo: '/inbox',
  })) assert(push?.params[key] === value, `${role}: warranty preserves ${key}`);
}
const customerInboxWarranty = resolvePushLink(
  navigationTargetHref(warrantyRoute('customer', { projectId: 'project-3', source: 'inbox' })),
  '/inbox',
  'customer',
);
const contractorInboxWarranty = resolvePushLink(
  navigationTargetHref(warrantyRoute('contractor', { projectId: 'project-3', source: 'inbox' })),
  '/inbox',
  'contractor',
);
assert(customerInboxWarranty?.pathname === '/documents' && customerInboxWarranty.params.tab === 'warranty', 'customer Inbox warranty -> Documents');
assert(contractorInboxWarranty?.pathname === '/quality-control' && contractorInboxWarranty.params.filter === 'warranty', 'contractor Inbox warranty -> QC');
assert(resolvePushLink('/quality-control?issueId=q1', '/origin', 'customer')?.params.tab === 'control', 'customer QC opens Repair Control');
assert(resolvePushLink('/work-acceptance', '/origin', 'customer')?.params.tab === 'control', 'acceptance opens Repair Control');

const guestHeader = buildSecondaryNavigation({ role: 'customer', readOnly: true, guest: true, dockItems: DOCK_DEFAULT, surface: 'header' });
const guestHome = buildSecondaryNavigation({ role: 'customer', readOnly: true, guest: true, dockItems: DOCK_DEFAULT, surface: 'home' });
assert(guestHeader.map((route) => route.id).join(',') === 'documents,inbox', 'guest header contract');
assert(guestHome.map((route) => route.id).join(',') === 'documents,inbox', 'guest Home contract');

assert(activeDockItemId(DOCK_PRESET_SETUP, { pathname: '/(customer)/(tabs)/object', params: { tab: 'estimate' } }) === 'estimate', 'setup estimate exclusive');
assert(DOCK_PRESET_SETUP.filter((id) => id === activeDockItemId(DOCK_PRESET_SETUP, { pathname: '/object', params: { tab: 'estimate' } })).length === 1, 'one setup active item');

const attention = buildAttentionBadgeState({ chatUnread: 3, taskUnread: 2, todayTasks: 9 });
const badges = resolveHeaderMoreBadge(attention.inboxTaskUnread, attention.chatUnread);
assert(badges.length === 2 && badges[0]?.kind === 'chat' && badges[1]?.kind === 'tasks', 'chat and task badges coexist');
assert(attention.calendarTodayTasks === 9 && attention.inboxTaskUnread === 2, 'calendar tasks stay separate');

console.log('navigationIntegration.test OK');
