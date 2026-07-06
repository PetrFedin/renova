/** Inbox — единая очередь задач проекта */
import { useLocalSearchParams } from 'expo-router';
import { UnifiedInboxScreen } from '@/components/screens/UnifiedInboxScreen';
import { useRenova } from '@/lib/context/RenovaContext';

export default function InboxRoute() {
  const { returnTo, heroKind } = useLocalSearchParams<{ returnTo?: string; heroKind?: string }>();
  const { user } = useRenova();
  const role = user?.role === 'contractor' ? 'contractor' : 'customer';
  return <UnifiedInboxScreen role={role} returnTo={returnTo} heroKind={heroKind} />;
}
