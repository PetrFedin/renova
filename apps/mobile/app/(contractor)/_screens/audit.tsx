import { useEffect, useState } from 'react';
import { ScrollView, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import { useRenova } from '@/lib/context/RenovaContext';
import { api } from '@/lib/api';
import { RenovaTheme } from '@/constants/Theme';

export default function AuditScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { user } = useRenova();
  const [logs, setLogs] = useState<any[]>([]);
  useEffect(() => { if (user) api.getAuditLogs(user.id).then(setLogs); }, [user?.id]);
  return (<>
      <BackHeader title="Журнал аудита" returnTo={returnTo} /><ScrollView style={s.wrap}>{logs.map((l) => (
    <Text key={l.id} style={s.row}>{l.created_at.slice(0,16)} {l.method} {l.path} → {l.status_code}</Text>
  ))}</ScrollView></>);
}
const s = StyleSheet.create({ wrap: { flex: 1, padding: 16, backgroundColor: RenovaTheme.colors.background }, row: { fontSize: 11, marginBottom: 6 } });
