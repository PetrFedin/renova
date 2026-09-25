import type { ComponentType } from 'react';
import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/Themed';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useRenova } from '@/lib/context/RenovaContext';
import { type OsRole } from '@/constants/osSections';
import { goBack, goHome } from '@/lib/navigation';
import { resolveCatchAllSlug } from '@/lib/resolveCatchAllSlug';
import S_budget_planner from './budget-planner';
import S_checklist_templates from './checklist-templates';
import S_conflicts from './conflicts';
import S_guide from './guide';
import S_job_leads from './job-leads';
import S_manager_dashboard from './manager-dashboard';
import S_portfolio from './portfolio';
import S_reports from './reports';
import S_scratchpad from './scratchpad';

/**
 * Shared SoT for "stack" screens reachable via a bare single-segment path
 * (reports/guide/scratchpad/job-leads/…). Rendered from BOTH the root
 * catch-all `app/[slug].tsx` AND the role-scoped catch-all
 * `app/(contractor)/[tool].tsx`.
 *
 * Why both: expo-router treats a route GROUP like `(contractor)` as
 * path-transparent, so `app/(contractor)/[tool].tsx` and `app/[slug].tsx`
 * both register a pattern that matches the exact same single-segment URL
 * (e.g. `/job-leads`). Which one expo-router's linking resolver actually
 * picks for a given `router.push` is an implementation detail we must not
 * depend on. Previously `(contractor)/[tool].tsx` had its OWN, narrower
 * map that didn't know about STACK_KEYS and unconditionally redirected any
 * unmapped segment back to `/(contractor)/(tabs)` — when expo-router chose
 * that nested match for a STACK_KEYS path, the app bounced back into the
 * still-mounted tabs Slot instead of opening the intended stack screen
 * (job-leads, reports, guide, …), and role-tab side effects re-rendering
 * that Slot are what produced the "Maximum update depth exceeded" loop.
 *
 * Fix: both catch-alls now render this single component, so no matter
 * which pattern expo-router resolves to, the result is identical and
 * correct — never a mystery redirect back into tabs.
 */
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

export function AppCatchAllScreen() {
  const params = useLocalSearchParams<{ slug?: string; tool?: string; returnTo?: string }>();
  const seg = (Array.isArray(params.slug) ? params.slug[0] : params.slug)
    || (Array.isArray(params.tool) ? params.tool[0] : params.tool);
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

  const missingSlug = resolved.kind === 'not_found' ? resolved.slug : seg || '';

  return (
    <>
      <Stack.Screen options={{ title: 'Не найдено', headerShown: true, headerBackVisible: false }} />
      <View style={styles.container}>
        <Text style={styles.title}>Такого экрана нет</Text>
        <Text style={styles.sub}>
          {missingSlug
            ? `Маршрут «/${missingSlug}» устарел или не существует. Откройте главную или документы.`
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
