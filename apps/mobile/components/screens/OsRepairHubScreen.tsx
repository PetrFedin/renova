/** Hub «Ремонт»: Этапы · Материалы · Приёмка */
import { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { OsHubTabs, type HubTab } from '@/components/renova/os/OsHubTabs';
import { OsWorksScreen } from '@/components/screens/OsWorksScreen';
import { OsMaterialsScreen } from '@/components/screens/OsMaterialsScreen';
import { OsControlScreen } from '@/components/screens/OsControlScreen';
import { useHubTab } from '@/lib/useHubTab';
import { useRenova } from '@/lib/context/RenovaContext';
import { ProjectScopeLoader } from '@/components/renova/ProjectScopeLoader';
import { api } from '@/lib/api';
import { tabsRoute, type OsRole } from '@/constants/osSections';

const TAB_IDS = ['works', 'materials', 'control'] as const;

export function OsRepairHubScreen({ role }: { role: OsRole }) {
  const { tab: tabParam, subtab: subtabParam } = useLocalSearchParams<{ tab?: string; subtab?: string }>();
  const { user, activeProject } = useRenova();
  const [active, setActive] = useHubTab(TAB_IDS, 'works');
  const [pendingAcceptance, setPendingAcceptance] = useState(0);

  /** Календарь — отдельный раздел dock/меню, не вкладка «Ремонт» */
  useEffect(() => {
    if (tabParam === 'calendar') {
      router.replace(tabsRoute(role, 'calendar') as any);
    }
  }, [tabParam, role]);

  /** Deep link materials-procurement → materials + optional subtab */
  useEffect(() => {
    if (typeof subtabParam === 'string' && ['picks', 'purchases', 'receipts'].includes(subtabParam)) {
      setActive('materials');
    }
  }, [subtabParam, setActive]);

  const reloadBadge = useCallback(() => {
    if (!user || !activeProject) return;
    api.acceptancesPendingCount(user.id, activeProject.id).then((r) => setPendingAcceptance(r.count)).catch(() => setPendingAcceptance(0));
  }, [user?.id, activeProject?.id]);

  useFocusEffect(useCallback(() => { reloadBadge(); }, [reloadBadge]));

  const controlBadge = pendingAcceptance > 0 ? pendingAcceptance : undefined;

  const tabs: HubTab[] = [
    { id: 'works', label: 'Этапы' },
    { id: 'materials', label: 'Материалы' },
    { id: 'control', label: 'Приёмка', badge: controlBadge || undefined },
  ];

  return (
    <ProjectScopeLoader role={role}>
      <View style={s.root}>
        <OsHubTabs tabs={tabs} value={active} onChange={setActive} />
        <View style={s.body}>
          {active === 'works' && <OsWorksScreen role={role} />}
          {active === 'materials' && <OsMaterialsScreen role={role} />}
          {active === 'control' && <OsControlScreen role={role} />}
        </View>
      </View>
    </ProjectScopeLoader>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1 },
});
