/** Вкладка «Отклонения» — аналитика, перерасход, риски бюджета */
import { View } from 'react-native';
import { ProjectAnalyticsPanel } from '@/components/renova/ProjectAnalyticsPanel';
import { BudgetAlerts, type BudgetAlert } from '@/components/renova/BudgetAlerts';
import type { OsRole } from '@/constants/osSections';

type Props = {
  role: OsRole;
  alerts: BudgetAlert[];
  returnTo?: string;
};

export function BudgetDeviationsSection({ role, alerts, returnTo }: Props) {
  return (
    <View>
      {alerts.length > 0 && <BudgetAlerts items={alerts} returnTo={returnTo} />}
      <ProjectAnalyticsPanel full />
    </View>
  );
}
