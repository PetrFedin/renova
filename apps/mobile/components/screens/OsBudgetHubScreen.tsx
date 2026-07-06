/** Hub «Бюджет»: Сводка · Расходы · Оплаты · Комнаты · Этапы · Аналитика */
import { View, StyleSheet } from 'react-native';
import { OsHubTabs, type HubTab } from '@/components/renova/os/OsHubTabs';
import { OsBudgetScreen, type BudgetTab } from '@/components/screens/OsBudgetScreen';
import { ProjectScopeLoader } from '@/components/renova/ProjectScopeLoader';
import { useHubTab } from '@/lib/useHubTab';
import type { OsRole } from '@/constants/osSections';

const TABS: HubTab[] = [
  { id: 'summary', label: 'Сводка' },
  { id: 'expenses', label: 'Расходы' },
  { id: 'payments', label: 'Оплаты' },
  { id: 'rooms', label: 'Комнаты' },
  { id: 'stages', label: 'Этапы' },
  { id: 'analytics', label: 'Аналитика' },
];

/** Все id для deep link (?tab=) — совпадают с вкладками в шапке */
const TAB_IDS = ['summary', 'expenses', 'payments', 'analytics', 'rooms', 'stages'] as const;

export function OsBudgetHubScreen({ role }: { role: OsRole }) {
  const [active, setActive] = useHubTab(TAB_IDS, 'summary', `renova_budget_hub_tab_${role}`);

  return (
    <ProjectScopeLoader role={role}>
      <View style={s.root}>
        <OsHubTabs tabs={TABS} value={active} onChange={(id) => setActive(id as BudgetTab)} />
        <OsBudgetScreen role={role} tab={active as BudgetTab} />
      </View>
    </ProjectScopeLoader>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
});
