import { OsHomeScreen } from '@/components/screens/OsHomeScreen';
import { OsTabFocusGate } from '@/components/renova/os/OsTabFocusGate';

export default function TabScreen() {
  return (
    <OsTabFocusGate routeName="index">
      <OsHomeScreen role="contractor" />
    </OsTabFocusGate>
  );
}
