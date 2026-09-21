/** Единый redirect legacy tab-маршрутов → hub (см. TAB_ALIASES в legacyRoutes.ts) */
import { useMemo } from 'react';
import { Redirect, useGlobalSearchParams } from 'expo-router';
import { TAB_ALIASES, resolveLegacyRoute } from '@/lib/legacyRoutes';

/**
 * Stack-экраны живут в app/*.tsx / [slug].
 * Если Slot поймал их как (tabs)/[legacyTab] — выталкиваем на корень,
 * иначе Redirect на тот же path → Maximum update depth.
 */
const ROOT_STACK_SLUGS = new Set([
  'portfolio',
  'reports',
  'guide',
  'scratchpad',
  'budget-planner',
  'manager-dashboard',
  'job-leads',
  'checklist-templates',
  'conflicts',
]);

export function LegacyTabRedirect({ path }: { path: string }) {
  const query = useGlobalSearchParams<Record<string, string | string[]>>();
  const returnToRaw = query.returnTo;
  const returnTo = Array.isArray(returnToRaw) ? returnToRaw[0] : returnToRaw;

  const href = useMemo(() => {
    const seg = path.split('/').filter(Boolean).pop() || '';
    if (ROOT_STACK_SLUGS.has(seg)) {
      return {
        pathname: `/${seg}`,
        params: returnTo ? { returnTo } : undefined,
      };
    }
    if (!TAB_ALIASES[path]) {
      // Неизвестный сегмент: не Redirect на себя (цикл). На главную роли.
      // Главная — это корень группы вкладок: файла `index` в адресе нет, и
      // ссылка на него приводила туда же, откуда мы уходим, — в «Такого
      // экрана нет».
      const role = path.includes('(contractor)') ? 'contractor' : 'customer';
      return { pathname: `/(${role})/(tabs)/` as const };
    }
    const route = resolveLegacyRoute(path);
    return {
      pathname: route.pathname,
      params: {
        ...(route.params || {}),
        ...(returnTo ? { returnTo } : {}),
      },
    };
  }, [path, returnTo]);

  return <Redirect href={href as never} />;
}
