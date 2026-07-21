/** Нормализация deep link из push-уведомлений */
import { calendarTabRoute, budgetTabRoute, objectTabRoute, parseOsHref, repairTabRoute, tabsRoute, type OsRole } from '../constants/osSections';
import { TAB_ALIASES, legacyRouteCanonical, logLegacyRouteDeprecation } from './legacyRoutes';

export type PushTarget = { pathname: string; params: Record<string, string> };

export { TAB_ALIASES };

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

  if (canonicalPath === '/finance-center') {
    const target = budgetTabRoute(role, 'payments');
    return { pathname: target.pathname, params: { ...(target.params || {}), returnTo: rt } };
  }

  if (canonicalPath === '/control') {
    // W58: обе роли → hub Приёмка (repair?tab=control); /work-acceptance остаётся API-экраном
    const tab = role === 'contractor' ? '/(contractor)/(tabs)/repair' : '/(customer)/(tabs)/repair';
    return { pathname: tab, params: { tab: 'control', returnTo: rt } };
  }

  if (canonicalPath === '/work-schedule') {
    const target = calendarTabRoute(role);
    return { pathname: target.pathname, params: { ...(target.params || {}), returnTo: rt } };
  }

  if (canonicalPath === '/notifications') {
    return { pathname: '/inbox', params: { returnTo: rt } };
  }

  // W101: /profile → таб профиля роли (нет корневого app/profile)
  if (canonicalPath === '/profile') {
    const tab = role === 'contractor' ? '/(contractor)/(tabs)/profile' : '/(customer)/(tabs)/profile';
    return { pathname: tab, params: { returnTo: rt } };
  }

  // W101: /design → объект/план (design packages)
  if (canonicalPath === '/design') {
    const target = objectTabRoute(role, 'plan');
    return { pathname: target.pathname, params: { ...(target.params || {}), returnTo: rt } };
  }

  // W101/W121: QC заказчика → hub Приёмка; с issueId — stack QC (Fieldwire focus)
  if (canonicalPath === '/quality-control' && role === 'customer') {
    const q = new URLSearchParams(canonicalQuery || '');
    const issueId = q.get('issueId') || undefined;
    if (issueId) {
      return { pathname: '/quality-control', params: { issueId, returnTo: rt } };
    }
    return { pathname: '/(customer)/(tabs)/repair', params: { tab: 'control', returnTo: rt } };
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
  const stackPaths = ['/approvals', '/activity', '/documents', '/inbox', '/conflicts', '/scan-receipt', '/job-leads', '/checklist-templates', '/work-order', '/scratchpad'];
  if (stackPaths.includes(canonicalPath)) {
    return { pathname: canonicalPath, params: { returnTo: rt } };
  }
  if (canonicalPath in TAB_ALIASES || canonicalPath.startsWith('/(customer)/') || canonicalPath.startsWith('/(contractor)/')) {
    const raw = canonicalQuery ? `${canonicalPath}?${canonicalQuery}` : canonicalPath;
    const { pathname, params: tabParams } = parseOsHref(raw);
    return { pathname, params: { ...tabParams, returnTo: rt } };
  }
  return { pathname: canonicalPath, params: { returnTo: rt } };
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
export function resolveNotificationLink(notificationType: string, role: OsRole = 'customer'): PushTarget | null {
  switch (notificationType) {
    case 'payment_pending':
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
    case 'deadline':
    case 'waste_reminder':
      return tabsRoute(role, 'calendar');
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
