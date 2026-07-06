import { OsObjectHubScreen } from '@/components/screens/OsObjectHubScreen';
import { OsTabFocusGate } from '@/components/renova/os/OsTabFocusGate';

export default function TabScreen() {
  return (
    <OsTabFocusGate routeName="object">
      <OsObjectHubScreen role="contractor" />
    </OsTabFocusGate>
  );
}
