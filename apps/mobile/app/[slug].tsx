import type { ComponentType } from 'react';
import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/Themed';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useRenova } from '@/lib/context/RenovaContext';
import { type OsRole } from '@/constants/osSections';
import { goBack, goHome } from '@/lib/navigation';
import { resolveCatchAllSlug } from '@/lib/resolveCatchAllSlug';
import S_budget_planner from './_stack/budget-planner';
import S_checklist_templates from './_stack/checklist-templates';
import S_conflicts from './_stack/conflicts';
import S_guide from './_stack/guide';
import S_job_leads from './_stack/job-leads';
import S_manager_dashboard from './_stack/manager-dashboard';
import S_portfolio from './_stack/portfolio';
import S_reports from './_stack/reports';
import S_scratchpad from './_stack/scratchpad';

const STACK: Record<string, ComponentType> = {
  'budget-planner': S_budget_planner,
  'checklist-templates': S_checklist_templates,
  'conflicts': S_conflicts,
  'guide': S_guide,
  'job-leads': S_job_leads,
  'manager-dashboard': S_manager_dashboard,
  'portfolio': S_portfolio,
  'reports': S_reports,
  'scratchpad': S_scratchpad,
};

const STACK_KEYS = Object.keys(STACK);

/**
 * P3-W52: root catch-all — stack screens + legacy/registry redirects.
 * Неизвестные slug → честный 404 (не «второй продукт»).
 */
export default function RootSlugCatchAll() {
  const params = useLocalSearchParams<{ slug?: string; tab?: string; returnTo?: string }>();
  const seg = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const { user } = useRenova();
  const role: OsRole = user?.role === 'contractor' ? 'contractor' : 'customer';
  const rt = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;

  const resolved = resolveCatchAllSlug(seg, role, STACK_KEYS);

  if (resolved.kind === 'stack' && seg && STACK[seg]) {
    const Comp = STACK[seg];
    return <Comp />;
  }

  if (resolved.kind === 'redirect') {
    const href = resolved.href;
    if (typeof href === 'string') {
      return <Redirect href={href as never} />;
    }
    return (
      <Redirect
        href={{
          pathname: href.pathname,
          params: {
            ...(href.params || {}),
            ...(rt ? { returnTo: rt } : {}),
          },
        } as never}
      />
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Не найдено', headerShown: true, headerBackVisible: false }} />
      <View style={styles.container}>
        <Text style={styles.title}>Такого экрана нет</Text>
        <Text style={styles.sub}>
          {resolved.slug
            ? `Маршрут «/${resolved.slug}» устарел или не существует. Откройте главную или документы.`
            : 'Проверьте ссылку или вернитесь на главную'}
        </Text>
        <View style={styles.actions}>
          <PrimaryButton title="← Назад" variant="outline" onPress={() => goBack(undefined, role)} />
          <PrimaryButton title="На главную" onPress={() => goHome(role)} />
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
  sub: { fontSize: 14, color: '#64748b', textAlign: 'center', marginBottom: 24 },
  actions: { width: '100%', maxWidth: 280, gap: 10 },
});
