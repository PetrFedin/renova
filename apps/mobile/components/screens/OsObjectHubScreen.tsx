/** Hub «Объект»: Профиль · Комнаты · Смета · План */
import { View, StyleSheet } from 'react-native';
import { OsHubTabs, type HubTab } from '@/components/renova/os/OsHubTabs';
import { OsProjectProfileScreen } from '@/components/screens/OsProjectProfileScreen';
import { OsRoomsScreen } from '@/components/screens/OsRoomsScreen';
import { OsEstimateScreen } from '@/components/screens/OsEstimateScreen';
import { OsPlanTabScreen } from '@/components/screens/OsPlanTabScreen';
import { ObjectTabProgress } from '@/components/screens/object/ObjectTabProgress';
import { ProjectScopeLoader } from '@/components/renova/ProjectScopeLoader';
import { useHubTab } from '@/lib/useHubTab';
import type { OsRole } from '@/constants/osSections';
import type { ObjectTabId } from '@/components/screens/object/ObjectTabGuide';

const TABS: HubTab[] = [
  { id: 'profile', label: 'Данные объекта' },
  { id: 'rooms', label: 'Комнаты' },
  { id: 'estimate', label: 'Смета' },
  { id: 'plan', label: 'План' },
];

const TAB_IDS = ['profile', 'rooms', 'estimate', 'plan'] as const;

export function OsObjectHubScreen({ role }: { role: OsRole }) {
  const [active, setActive] = useHubTab(TAB_IDS, 'profile');

  const goTab = (tab: ObjectTabId) => setActive(tab);

  return (
    <ProjectScopeLoader role={role}>
      <View style={s.root}>
        <OsHubTabs tabs={TABS} value={active} onChange={(id) => goTab(id as ObjectTabId)} />
        <ObjectTabProgress active={active} onChange={goTab} />
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
