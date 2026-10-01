/** Единый redirect legacy tab-маршрутов → hub (см. TAB_ALIASES в legacyRoutes.ts) */
import { useMemo } from 'react';
import { Redirect, useGlobalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/Themed';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import type { OsRole } from '@/constants/osSections';
import { goBack, goHome } from '@/lib/navigation';
import { TAB_ALIASES, resolveLegacyRoute } from '@/lib/legacyRoutes';
import { legacySlugRedirect } from '@/lib/resolveCatchAllSlug';

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
      // Реестровые legacy-slug (finance-center, design, work-schedule…) → их канон, а не на главную.
      const role0 = path.includes('(contractor)') ? 'contractor' : 'customer';
      const legacy = legacySlugRedirect(seg, role0);
      if (legacy) return legacy as never;
      // Неизвестный сегмент: Redirect на index при смонтированном Slot даёт цикл
      // «Maximum update depth» (live-audit-2) — показываем честный экран «не найдено».
      return null;
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

  if (!href) {
    const role: OsRole = path.includes('(contractor)') ? 'contractor' : 'customer';
    const seg = path.split('/').filter(Boolean).pop() || '';
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Такого экрана нет</Text>
        <Text style={styles.sub}>{`Маршрут «/${seg}» устарел или не существует. Откройте главную или документы.`}</Text>
        <View style={styles.actions}>
          <PrimaryButton title="← Назад" variant="outline" onPress={() => goBack(undefined, role)} />
          <PrimaryButton title="На главную" onPress={() => goHome(role)} />
        </View>
      </View>
    );
  }
  return <Redirect href={href as never} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
  sub: { fontSize: 14, color: '#64748b', textAlign: 'center', marginBottom: 24 },
  actions: { width: '100%', maxWidth: 280, gap: 10 },
});
