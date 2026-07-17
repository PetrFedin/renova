/** Нормализация deep link из push-уведомлений */
import { budgetTabRoute, parseOsHref, repairTabRoute, tabsRoute, type OsRole } from '../constants/osSections';
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
  const stackPaths = ['/approvals', '/activity', '/documents', '/inbox', '/conflicts', '/scan-receipt', '/job-leads', '/design', '/checklist-templates', '/work-order', '/scratchpad'];
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

/** Fallback router when push payload has no link_path */
export function resolveNotificationLink(notificationType: string, role: OsRole = 'customer'): PushTarget | null {
  switch (notificationType) {
    case 'payment_pending':
      return budgetTabRoute(role, 'payments');
    case 'stage_review':
    case 'stage_started':
      return { pathname: '/work-acceptance', params: {} };
    case 'change_order':
      return budgetTabRoute(role, 'payments');
    case 'materials':
      return repairTabRoute(role, 'materials');
    case 'chat_message':
      return tabsRoute(role, 'chat');
    case 'budget_alert':
      return budgetTabRoute(role, 'summary');
    case 'document':
      return { pathname: '/documents', params: {} };
    case 'issue':
      return { pathname: '/quality-control', params: {} };
    case 'approval':
      return { pathname: '/approvals', params: {} };
    case 'deadline':
    case 'waste_reminder':
      return tabsRoute(role, 'calendar');
    default:
      return null;
  }
}
