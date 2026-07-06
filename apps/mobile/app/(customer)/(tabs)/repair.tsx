import { OsRepairHubScreen } from '@/components/screens/OsRepairHubScreen';
import { OsTabFocusGate } from '@/components/renova/os/OsTabFocusGate';

export default function TabScreen() {
  return (
    <OsTabFocusGate routeName="repair">
      <OsRepairHubScreen role="customer" />
    </OsTabFocusGate>
  );
}
