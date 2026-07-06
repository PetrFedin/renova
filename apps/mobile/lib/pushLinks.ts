/** Нормализация deep link из push-уведомлений */
import { parseOsHref } from '../constants/osSections';

export type PushTarget = { pathname: string; params: Record<string, string> };

/** Legacy tab-маршруты → канонические hub-пути */
export const TAB_ALIASES: Record<string, string> = {
  '/(customer)/(tabs)/finance': '/(customer)/(tabs)/budget',
  '/(customer)/(tabs)/more': '/(customer)/(tabs)/profile',
  '/(customer)/(tabs)/works': '/(customer)/(tabs)/repair?tab=works',
  '/(customer)/(tabs)/materials': '/(customer)/(tabs)/repair?tab=materials',
  '/(customer)/(tabs)/control': '/(customer)/(tabs)/repair?tab=control',
  '/(customer)/(tabs)/stages': '/(customer)/(tabs)/repair?tab=works',
  '/(customer)/(tabs)/rooms': '/(customer)/(tabs)/object?tab=rooms',
  '/(customer)/(tabs)/estimate': '/(customer)/(tabs)/object?tab=estimate',
  '/project-analytics': '/(customer)/(tabs)/budget?tab=analytics',
  '/(customer)/(tabs)/plan': '/(customer)/(tabs)/object?tab=plan',
  '/(contractor)/(tabs)/money': '/(contractor)/(tabs)/budget',
  '/(contractor)/(tabs)/more': '/(contractor)/(tabs)/profile',
  '/(contractor)/(tabs)/works': '/(contractor)/(tabs)/repair?tab=works',
  '/(contractor)/(tabs)/materials': '/(contractor)/(tabs)/repair?tab=materials',
  '/(contractor)/(tabs)/control': '/(contractor)/(tabs)/repair?tab=control',
  '/(contractor)/(tabs)/stages': '/(contractor)/(tabs)/repair?tab=works',
  '/(contractor)/(tabs)/rooms': '/(contractor)/(tabs)/object?tab=rooms',
  '/(contractor)/(tabs)/estimate': '/(contractor)/(tabs)/object?tab=estimate',
  '/(contractor)/(tabs)/plan': '/(contractor)/(tabs)/object?tab=plan',
  '/(contractor)/(tabs)/objects': '/(contractor)/(tabs)/',
};

/** Redirect href для legacy tab-файлов (finance, more, calendar…) */
export function resolveLegacyTabHref(legacyPath: string) {
  return parseOsHref(TAB_ALIASES[legacyPath] || legacyPath);
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
