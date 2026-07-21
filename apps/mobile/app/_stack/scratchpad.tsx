import { ScratchpadScreen } from '@/components/screens/ScratchpadScreen';
import { useLocalSearchParams } from 'expo-router';
import type { OsRole } from '@/constants/osSections';

export default function ScratchpadRoute() {
  const { role: roleParam } = useLocalSearchParams<{ role?: string }>();
  const role: OsRole = roleParam === 'contractor' ? 'contractor' : 'customer';
  return <ScratchpadScreen role={role} />;
}
