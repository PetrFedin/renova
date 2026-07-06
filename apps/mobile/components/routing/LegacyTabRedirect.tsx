/** Единый redirect legacy tab-маршрутов → hub (см. TAB_ALIASES в legacyRoutes.ts) */
import { Redirect, useGlobalSearchParams } from 'expo-router';
import { resolveLegacyRoute } from '@/lib/legacyRoutes';

export function LegacyTabRedirect({ path }: { path: string }) {
  const query = useGlobalSearchParams<Record<string, string | string[]>>();
  const route = resolveLegacyRoute(path);
  const returnTo = query.returnTo;
  const merged = {
    ...(route.params || {}),
    ...(returnTo ? { returnTo: Array.isArray(returnTo) ? returnTo[0] : returnTo } : {}),
  };
  return <Redirect href={{ pathname: route.pathname, params: merged } as any} />;
}
