import { OsBudgetHubScreen } from '@/components/screens/OsBudgetHubScreen';
import { OsTabFocusGate } from '@/components/renova/os/OsTabFocusGate';

export default function TabScreen() {
  return (
    <OsTabFocusGate routeName="budget">
      <OsBudgetHubScreen role="customer" />
    </OsTabFocusGate>
  );
}
