import { ScrollView } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useRenova } from '@/lib/context/RenovaContext';
import { BackHeader } from '@/components/renova/BackHeader';
import { JobLeadsBoard } from '@/components/renova/JobLeadsBoard';

export default function JobLeadsScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { user } = useRenova();
  if (!user) return null;
  return (<><BackHeader title="Заявки" returnTo={returnTo} /><ScrollView style={{ padding:16 }}><JobLeadsBoard userId={user.id} role={user.role} /></ScrollView></>);
}
