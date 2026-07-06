/** Hub «Деньги»: Сводка · Расходы · Оплаты · Отклонения (≤4 вкладки) */
import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { OsHubTabs } from '@/components/renova/os/OsHubTabs';
import { OsBudgetScreen } from '@/components/screens/OsBudgetScreen';
import { ProjectScopeLoader } from '@/components/renova/ProjectScopeLoader';
import { useHubTab } from '@/lib/useHubTab';
import { BUDGET_HUB_TABS, BUDGET_TAB_IDS, normalizeBudgetTab, type BudgetTab } from '@/constants/budgetTabs';
import type { OsRole } from '@/constants/osSections';

export function OsBudgetHubScreen({ role }: { role: OsRole }) {
  const { tab: tabParam, view: viewParam } = useLocalSearchParams<{ tab?: string; view?: string }>();
  const [active, setActive] = useHubTab(BUDGET_TAB_IDS, 'summary', `renova_budget_hub_tab_${role}`);

  useEffect(() => {
    if (typeof tabParam !== 'string') return;
    const normalized = normalizeBudgetTab(tabParam);
    const needsTab = normalized.tab !== tabParam;
    const needsView = normalized.view && normalized.view !== viewParam;
    if (needsTab || needsView) {
      router.setParams({
        tab: normalized.tab,
        ...(normalized.view ? { view: normalized.view } : {}),
      });
      setActive(normalized.tab);
    }
  }, [tabParam, viewParam, setActive]);

  return (
    <ProjectScopeLoader role={role}>
      <View style={s.root}>
        <OsHubTabs tabs={BUDGET_HUB_TABS} value={active} onChange={(id) => setActive(id as BudgetTab)} />
        <OsBudgetScreen role={role} tab={active as BudgetTab} />
      </View>
    </ProjectScopeLoader>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
});
