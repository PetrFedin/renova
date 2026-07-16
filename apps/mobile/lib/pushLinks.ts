/** Нормализация deep link из push-уведомлений */
import { parseOsHref } from '../constants/osSections';
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

export function resolvePushLink(link?: string | null, returnTo?: string | null): PushTarget | null {
  if (!link) return null;
  const [path, query = ''] = link.split('?');
  const rt = returnTo || '/';
  const canonical = TAB_ALIASES[path] || link;
  const canonicalPath = canonical.split('?')[0];
  const canonicalQuery = canonical.includes('?') ? canonical.split('?')[1] : query;

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
export function resolveNotificationLink(notificationType: string): PushTarget | null {
  switch (notificationType) {
    case 'payment_pending':
      return { pathname: '/finance-center', params: {} };
    case 'stage_review':
    case 'stage_started':
      return { pathname: '/work-acceptance', params: {} };
    case 'change_order':
      return { pathname: '/(customer)/(tabs)/budget', params: { tab: 'payments' } };
    case 'materials':
      return { pathname: '/(customer)/(tabs)/repair', params: { tab: 'materials' } };
    case 'chat_message':
      return { pathname: '/(customer)/(tabs)/chat', params: {} };
    case 'budget_alert':
      return { pathname: '/(customer)/(tabs)/budget', params: {} };
    case 'document':
      return { pathname: '/documents', params: {} };
    default:
      return null;
  }
}
