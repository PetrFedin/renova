/** Hub «Объект»: ≤2 primary (Комнаты · Смета), Данные/План — «Ещё» */
import { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { OsHubTabs, type HubTab } from '@/components/renova/os/OsHubTabs';
import { OsProjectProfileScreen } from '@/components/screens/OsProjectProfileScreen';
import { OsRoomsScreen } from '@/components/screens/OsRoomsScreen';
import { OsEstimateScreen } from '@/components/screens/OsEstimateScreen';
import { OsPlanTabScreen } from '@/components/screens/OsPlanTabScreen';
import { ProjectScopeLoader } from '@/components/renova/ProjectScopeLoader';
import { useHubTab } from '@/lib/useHubTab';
import type { OsRole } from '@/constants/osSections';
import type { ObjectTabId } from '@/components/screens/object/ObjectTabGuide';
import { useRenova } from '@/lib/context/RenovaContext';
import { api, type ResponsibilityQueue } from '@/lib/api';
import { ObjectResponsibilityStrip } from '@/components/renova/os/ObjectResponsibilityStrip';
import { repairTabRoute } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import { reportError } from '@/lib/reportError';

const TAB_IDS = ['profile', 'rooms', 'estimate', 'plan'] as const;

export function OsObjectHubScreen({ role }: { role: OsRole }) {
  const { user, activeProject } = useRenova();
  const [active, setActive] = useHubTab(TAB_IDS, 'rooms', `renova_object_hub_tab_${role}`);
  const [responsibilityQueue, setResponsibilityQueue] = useState<ResponsibilityQueue | null>(null);

  const reloadResponsibility = useCallback(() => {
    if (!user || !activeProject) return;
    api.responsibilityQueue(user.id, activeProject.id)
      .then(setResponsibilityQueue)
      .catch((error) => reportError('components.screens.OsObjectHubScreen.ResponsibilityQueue', error));
  }, [user?.id, activeProject?.id]);

  useFocusEffect(useCallback(() => { reloadResponsibility(); }, [reloadResponsibility]));

  const goTab = (tab: ObjectTabId) => setActive(tab);

  const tabs: HubTab[] = useMemo(
    () => [
      { id: 'rooms', label: 'Комнаты' },
      { id: 'estimate', label: 'Смета' },
      { id: 'plan', label: 'План', secondary: true },
      { id: 'profile', label: 'Данные', secondary: true },
    ],
    [],
  );

  return (
    <ProjectScopeLoader role={role}>
      <View style={s.root}>
        <OsHubTabs tabs={tabs} value={active} onChange={(id) => goTab(id as ObjectTabId)} />
        {user ? (
          <ObjectResponsibilityStrip
            queue={responsibilityQueue}
            userId={user.id}
            onOpenAction={() => pushOsNav(repairTabRoute(role, 'control'), undefined, role)}
          />
        ) : null}
        <View style={s.body}>
          {active === 'profile' && <OsProjectProfileScreen role={role} onNextTab={goTab} />}
          {active === 'rooms' && <OsRoomsScreen role={role} onNextTab={goTab} />}
          {active === 'estimate' && <OsEstimateScreen role={role} onNextTab={goTab} />}
          {active === 'plan' && <OsPlanTabScreen role={role} onNextTab={goTab} />}
        </View>
      </View>
    </ProjectScopeLoader>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1 },
});
