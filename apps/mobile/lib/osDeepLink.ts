/**
 * W107: строки вида `/stage/{uuid}` → Expo Router `{ pathname: '/stage/[id]', params }`.
 * Без зависимости от expo-router — используется pushOsNav и smoke-тестами.
 */
import type { OsTabRoute } from '@/constants/osSections';

const DYNAMIC_PREFIXES: { prefix: string; pathname: string; param: string }[] = [
  { prefix: '/stage/', pathname: '/stage/[id]', param: 'id' },
  { prefix: '/chat/', pathname: '/chat/[threadId]', param: 'threadId' },
  { prefix: '/work-order/', pathname: '/work-order/[id]', param: 'id' },
  { prefix: '/room/', pathname: '/room/[id]', param: 'id' },
  { prefix: '/material/', pathname: '/material/[id]', param: 'id' },
  { prefix: '/purchase/', pathname: '/purchase/[id]', param: 'id' },
];

/** Резолв deep-link строк в Expo Router target */
export function resolveOsDeepLink(href: string, returnTo?: string): OsTabRoute | null {
  const path = href.split('?')[0];
  // Уже канонический dynamic template — не трогаем
  if (path.includes('[') && path.includes(']')) return null;
  for (const rule of DYNAMIC_PREFIXES) {
    if (!path.startsWith(rule.prefix) || path.includes('(tabs)')) continue;
    const id = path.slice(rule.prefix.length).split('/')[0];
    if (!id) continue;
    const params: Record<string, string> = { [rule.param]: id };
    if (returnTo) params.returnTo = returnTo;
    return { pathname: rule.pathname, params };
  }
  return null;
}
