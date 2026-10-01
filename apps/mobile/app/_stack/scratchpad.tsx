import { ScratchpadScreen } from '@/components/screens/ScratchpadScreen';
import { useLocalSearchParams } from 'expo-router';
import { useRenova } from '@/lib/context/RenovaContext';
import type { OsRole } from '@/constants/osSections';

export default function ScratchpadRoute() {
  const { role: roleParam } = useLocalSearchParams<{ role?: string }>();
  const { user } = useRenova();
  // INB-22: роль берётся из сессии; параметр ?role — только запасной вариант до загрузки пользователя
  const role: OsRole = user
    ? (user.role === 'contractor' ? 'contractor' : 'customer')
    : (roleParam === 'contractor' ? 'contractor' : 'customer');
  return <ScratchpadScreen role={role} />;
}
