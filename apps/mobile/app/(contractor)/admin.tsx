import { useEffect, useState } from 'react';
import { ScrollView, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import { useRenova } from '@/lib/context/RenovaContext';
import { api } from '@/lib/api';
import { RenovaTheme } from '@/constants/Theme';

export default function AdminScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { user } = useRenova();
  const [s, setS] = useState<any>(null);
  useEffect(() => { if (user) api.getAdminStats(user.id).then(setS); }, [user?.id]);
  return (<>
      <BackHeader title="Админ" returnTo={returnTo} /><ScrollView style={st.wrap}>
    {s && <><Text style={st.row}>Проекты: {s.projects}</Text><Text style={st.row}>Пользователи: {s.users}</Text><Text style={st.row}>События аудита: {s.audit_events}</Text></>}
  </ScrollView></>);
}
const st = StyleSheet.create({ wrap: { flex: 1, padding: 16, backgroundColor: RenovaTheme.colors.background }, row: { fontSize: 16, marginBottom: 8, fontWeight: '600' } });
