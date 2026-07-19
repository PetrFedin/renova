import type { ComponentType } from 'react';
import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/Themed';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useRenova } from '@/lib/context/RenovaContext';
import {
  budgetTabRoute,
  calendarTabRoute,
  objectTabHref,
  type OsRole,
} from '@/constants/osSections';
import { goBack, goHome } from '@/lib/navigation';
import { logLegacyRouteDeprecation } from '@/lib/legacyRoutes';
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

const LEGACY = new Set([
  'design',
  'finance-center',
  'work-schedule',
  'notifications',
  'project-analytics',
]);

/**
 * P3-W39: единый root catch-all —
 * legacy redirects + secondary stack screens.
 * Статические маршруты имеют приоритет.
 */
export default function RootSlugCatchAll() {
  const params = useLocalSearchParams<{ slug?: string; tab?: string; returnTo?: string }>();
  const seg = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const { user } = useRenova();
  const role: OsRole = user?.role === 'contractor' ? 'contractor' : 'customer';
  const rt = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;

  if (seg && STACK[seg]) {
    const Comp = STACK[seg];
    return <Comp />;
  }

  if (seg && LEGACY.has(seg)) {
    logLegacyRouteDeprecation(`/${seg}`, 'canonical');
  }

  if (seg === 'notifications') {
    return (
      <Redirect
        href={{
          pathname: '/inbox',
          params: rt ? { returnTo: rt } : undefined,
        }}
      />
    );
  }
  if (seg === 'work-schedule') {
    return <Redirect href={calendarTabRoute(role) as never} />;
  }
  if (seg === 'finance-center') {
    return <Redirect href={budgetTabRoute(role, 'payments') as never} />;
  }
  if (seg === 'project-analytics') {
    return <Redirect href={budgetTabRoute(role, 'deviations') as never} />;
  }
  if (seg === 'design') {
    const tab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
    const sub = tab === 'schedule' ? 'schedule' : 'design';
    return <Redirect href={objectTabHref(role, 'plan', sub) as never} />;
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Не найдено', headerShown: true, headerBackVisible: false }} />
      <View style={styles.container}>
        <Text style={styles.title}>Такого экрана нет</Text>
        <Text style={styles.sub}>Проверьте ссылку или вернитесь на главную</Text>
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
