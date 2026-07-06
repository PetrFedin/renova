import { OsCalendarScreen } from '@/components/screens/OsCalendarScreen';
import { OsTabFocusGate } from '@/components/renova/os/OsTabFocusGate';

export default function TabScreen() {
  return (
    <OsTabFocusGate routeName="calendar">
      <OsCalendarScreen role="contractor" />
    </OsTabFocusGate>
  );
}
