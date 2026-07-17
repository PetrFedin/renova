import { Redirect } from 'expo-router';
import { calendarTabRoute } from '@/constants/osSections';
import { useRenova } from '@/lib/context/RenovaContext';

/** P3.4: work-schedule → calendar hub (Schedule SoT — docs/SCHEDULE-SOT-2026-07-16.md) */
export default function WorkScheduleRoute() {
  const { user } = useRenova();
  const role = user?.role === 'contractor' ? 'contractor' : 'customer';
  const target = calendarTabRoute(role);
  return <Redirect href={target as never} />;
}
