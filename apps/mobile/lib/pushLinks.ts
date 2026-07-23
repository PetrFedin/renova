/** Нормализация deep link из push-уведомлений */
import { calendarTabRoute, budgetTabRoute, objectTabRoute, parseOsHref, repairTabRoute, tabsRoute, type OsRole } from '../constants/osSections';
import { TAB_ALIASES, legacyRouteCanonical, logLegacyRouteDeprecation } from './legacyRoutes';
import { resolveRegistryRedirect, warrantyRoute } from './navigation/navigationPolicy';

export type PushTarget = { pathname: string; params: Record<string, string> };

export { TAB_ALIASES };

export const STACK_PATHS = new Set([
  '/reports', '/manager-dashboard', '/guide', '/portfolio', '/budget-planner', '/scratchpad',
  '/checklist-templates', '/conflicts', '/documents', '/approvals', '/inbox', '/quality-control',
  '/activity', '/scan-receipt', '/job-leads',
]);

function queryParams(query: string): Record<string, string> {
  const params: Record<string, string> = {};
  new URLSearchParams(query).forEach((value, key) => { params[key] = value; });
  return params;
}

/** Redirect href для legacy tab-файлов (finance, more, calendar…) */
export function resolveLegacyTabHref(legacyPath: string) {
  const canonical = legacyRouteCanonical(legacyPath);
  if (TAB_ALIASES[legacyPath]) {
    logLegacyRouteDeprecation(legacyPath, canonical);
  }
  return parseOsHref(canonical);
}

export function resolvePushLink(
  link?: string | null,
  returnTo?: string | null,
  role: OsRole = 'customer',
): PushTarget | null {
  if (!link) return null;
  const [path, query = ''] = link.split('?');
  const rt = returnTo || '/';
  const canonical = TAB_ALIASES[path] || link;
  const canonicalPath = canonical.split('?')[0];
  const canonicalQuery = canonical.includes('?') ? canonical.split('?')[1] : query;
  const incoming = queryParams(canonicalQuery || '');

  const bareHub = canonicalPath.match(/^\/(object|repair|budget|calendar)$/)?.[1];
  if (bareHub) {
    const { tab, ...extra } = incoming;
    const target = tabsRoute(role, bareHub, tab, extra);
    return { pathname: target.pathname, params: { ...(target.params || {}), returnTo: rt } };
  }

  if (canonicalPath === '/project-analytics') {
    const target = resolveRegistryRedirect('project-analytics', role, incoming);
    if (!target) return { pathname: '/inbox', params: { returnTo: rt } };
    return { pathname: target.pathname, params: { ...(target.params || {}), returnTo: rt } };
  }

  if (canonicalPath === '/finance-center') {
    // W138: legacy «Финансовый центр» → Бюджет/Оплаты + sheet (не прямой confirm)
    const target = budgetTabRoute(role, 'payments', { openPayment: '1' });
    return { pathname: target.pathname, params: { ...incoming, ...(target.params || {}), returnTo: rt } };
  }

  if (canonicalPath === '/control' || canonicalPath === '/work-acceptance') {
    // W58 / W139: legacy control + отдельный центр → hub Ремонт → Приёмка
    const target = repairTabRoute(role, 'control');
    return { pathname: target.pathname, params: { ...incoming, ...(target.params || {}), returnTo: rt } };
  }

  if (canonicalPath === '/work-schedule') {
    const target = calendarTabRoute(role);
    return { pathname: target.pathname, params: { ...(target.params || {}), returnTo: rt } };
  }

  if (canonicalPath === '/notifications') {
    return { pathname: '/inbox', params: { returnTo: rt } };
  }

  if (canonicalPath === '/warranty' || canonicalPath === '/warranty-claim') {
    const target = warrantyRoute(role, { ...incoming, source: incoming.source || 'deeplink' });
    return { pathname: target.pathname, params: { ...(target.params || {}), returnTo: rt } };
  }

  // W101: /profile → таб профиля роли (нет корневого app/profile)
  if (canonicalPath === '/profile') {
    const tab = role === 'contractor' ? '/(contractor)/(tabs)/profile' : '/(customer)/(tabs)/profile';
    const focus = incoming.focus;
    return { pathname: tab, params: { ...(focus ? { focus } : {}), returnTo: rt } };
  }

  // W101: /design → объект/план (design packages)
  if (canonicalPath === '/design') {
    const target = objectTabRoute(role, 'plan');
    return { pathname: target.pathname, params: { ...(target.params || {}), returnTo: rt } };
  }

  // W101/W121: QC заказчика → hub Приёмка; с issueId — stack QC (Fieldwire focus)
  if (canonicalPath === '/quality-control' && role === 'customer') {
    const issueId = incoming.issueId;
    if (incoming.claimId) {
      const target = warrantyRoute(role, { ...incoming, source: incoming.source || 'deeplink' });
      return { pathname: target.pathname, params: { ...(target.params || {}), returnTo: rt } };
    }
    const target = repairTabRoute(role, 'control');
    return { pathname: target.pathname, params: { ...incoming, ...(target.params || {}), ...(issueId ? { issueId } : {}), returnTo: rt } };
  }

  if (canonicalPath.startsWith('/stage/')) {
    const id = canonicalPath.replace('/stage/', '').split('/')[0];
    return { pathname: '/stage/[id]', params: { id, returnTo: rt } };
  }
  if (canonicalPath.startsWith('/chat/') && !canonicalPath.includes('(tabs)')) {
    const threadId = canonicalPath.replace('/chat/', '').split('/')[0];
    return { pathname: '/chat/[threadId]', params: { threadId, returnTo: rt } };
  }
  if (canonicalPath.startsWith('/work-order/')) {
    const wid = canonicalPath.replace('/work-order/', '').split('/')[0];
    return { pathname: '/work-order/[id]', params: { id: wid, returnTo: rt } };
  }
  if (canonicalPath.startsWith('/room/')) {
    const id = canonicalPath.replace('/room/', '').split('/')[0];
    return { pathname: '/room/[id]', params: { id, returnTo: rt } };
  }
  if (canonicalPath.startsWith('/material/')) {
    const id = canonicalPath.replace('/material/', '').split('/')[0];
    return { pathname: '/material/[id]', params: { id, returnTo: rt } };
  }
  if (canonicalPath.startsWith('/purchase/')) {
    const id = canonicalPath.replace('/purchase/', '').split('/')[0];
    return { pathname: '/purchase/[id]', params: { id, returnTo: rt } };
  }
  if (STACK_PATHS.has(canonicalPath)) {
    return { pathname: canonicalPath, params: { ...incoming, returnTo: rt } };
  }
  if (canonicalPath in TAB_ALIASES || canonicalPath.startsWith('/(customer)/') || canonicalPath.startsWith('/(contractor)/')) {
    const raw = canonicalQuery ? `${canonicalPath}?${canonicalQuery}` : canonicalPath;
    const { pathname, params: tabParams } = parseOsHref(raw);
    return { pathname, params: { ...tabParams, returnTo: rt } };
  }
  return { pathname: canonicalPath, params: { ...incoming, returnTo: rt } };
}

/** change_order → объект/смета, слой «Доп. работы» (согласовано с approvalLinks) */
export function changeOrderEstimateRoute(role: OsRole, returnTo?: string): PushTarget {
  const route = objectTabRoute(role, 'estimate');
  return {
    pathname: route.pathname,
    params: { ...(route.params || {}), estimateLayer: 'changes', ...(returnTo ? { returnTo } : {}) },
  };
}

/** Fallback router when push payload has no link_path */
export function resolveNotificationLink(notificationType: string, role: OsRole = 'customer'): ReturnType<typeof tabsRoute> | null {
  switch (notificationType) {
    case 'payment_pending':
      return budgetTabRoute(role, 'payments', { openPayment: '1' });
    case 'payment_confirmed':
      return budgetTabRoute(role, 'payments');
    case 'stage_review':
    case 'stage_started':
    case 'acceptance':
      return {
        pathname: role === 'contractor' ? '/(contractor)/(tabs)/repair' : '/(customer)/(tabs)/repair',
        params: { tab: 'control' },
      };
    case 'change_order':
      return changeOrderEstimateRoute(role);
    case 'materials':
      return repairTabRoute(role, 'materials');
    case 'chat_message':
      return tabsRoute(role, 'chat');
    case 'budget_alert':
      return budgetTabRoute(role, 'summary');
    case 'schedule_review':
    case 'schedule_confirmed':
    case 'schedule_rejected':
      return {
        pathname: role === 'contractor' ? '/(contractor)/(tabs)/calendar' : '/(customer)/(tabs)/calendar',
        params: {},
      };
    case 'document':
      return { pathname: '/documents', params: {} };
    case 'issue':
      return role === 'customer'
        ? { pathname: '/(customer)/(tabs)/repair', params: { tab: 'control' } }
        : { pathname: '/quality-control', params: {} };
    case 'approval':
      return { pathname: '/approvals', params: {} };
    case 'warranty':
    case 'warranty_claim':
      return warrantyRoute(role, { source: 'push' });
    case 'deadline':
      return tabsRoute(role, 'calendar');
    case 'waste_reminder':
      // W124: остатки/материалы — не общий календарь
      return repairTabRoute(role, 'materials');
    case 'room_updated':
    case 'room_created':
      return objectTabRoute(role, 'rooms');
    case 'reaction':
      return tabsRoute(role, 'chat');
    case 'stage_start':
      return repairTabRoute(role, 'works');
    case 'budget':
      return budgetTabRoute(role, 'summary');
    case 'material':
      return repairTabRoute(role, 'materials');
    case 'estimate_lock':
    case 'estimate':
      return objectTabRoute(role, 'estimate');
    default:
      return { pathname: '/inbox', params: {} };
  }
}
