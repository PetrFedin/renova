/** Hub «Деньги»: Сводка · Расходы · Оплаты · Отклонения (≤4 вкладки) */
import { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { OsHubTabs } from '@/components/renova/os/OsHubTabs';
import { OsBudgetScreen } from '@/components/screens/OsBudgetScreen';
import { ProjectScopeLoader } from '@/components/renova/ProjectScopeLoader';
import { useHubTab } from '@/lib/useHubTab';
import { budgetHubTabsForRole, BUDGET_TAB_IDS, normalizeBudgetTab, type BudgetTab } from '@/constants/budgetTabs';
import type { OsRole } from '@/constants/osSections';
import { useRenova } from '@/lib/context/RenovaContext';
import { api, type ResponsibilityQueue } from '@/lib/api';
import { BudgetResponsibilityStrip } from '@/components/renova/os/BudgetResponsibilityStrip';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { reportError } from '@/lib/reportError';

export function OsBudgetHubScreen({ role }: { role: OsRole }) {
  const { tab: tabParam, view: viewParam } = useLocalSearchParams<{ tab?: string; view?: string }>();
  const { user, activeProject } = useRenova();
  const [active, setActive] = useHubTab(BUDGET_TAB_IDS, 'summary', `renova_budget_hub_tab_${role}`);
  const tabs = budgetHubTabsForRole(role);
  const [responsibilityQueue, setResponsibilityQueue] = useState<ResponsibilityQueue | null>(null);

  const reloadResponsibility = useCallback(() => {
    if (!user || !activeProject) return;
    api.responsibilityQueue(user.id, activeProject.id)
      .then(setResponsibilityQueue)
      .catch((error) => reportError('components.screens.OsBudgetHubScreen.ResponsibilityQueue', error));
  }, [user?.id, activeProject?.id]);

  useFocusEffect(useCallback(() => { reloadResponsibility(); }, [reloadResponsibility]));
  useProjectDataReload(reloadResponsibility);

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
        <OsHubTabs tabs={tabs} value={active} onChange={(id) => setActive(id as BudgetTab)} />
        {user ? (
          <BudgetResponsibilityStrip
            queue={responsibilityQueue}
            userId={user.id}
            onOpenPayments={() => setActive('payments')}
          />
        ) : null}
        <OsBudgetScreen role={role} tab={active as BudgetTab} />
      </View>
    </ProjectScopeLoader>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
});
