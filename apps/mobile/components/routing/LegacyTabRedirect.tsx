/** Единый redirect legacy tab-маршрутов → hub (см. TAB_ALIASES в pushLinks.ts) */
import { Redirect, useGlobalSearchParams } from 'expo-router';
import { resolveLegacyTabHref } from '@/lib/pushLinks';

export function LegacyTabRedirect({ path }: { path: string }) {
  const query = useGlobalSearchParams<Record<string, string | string[]>>();
  const route = resolveLegacyTabHref(path);
  const returnTo = query.returnTo;
  const merged = {
    ...(route.params || {}),
    ...(returnTo ? { returnTo: Array.isArray(returnTo) ? returnTo[0] : returnTo } : {}),
  };
  return <Redirect href={{ pathname: route.pathname, params: merged } as any} />;
}
