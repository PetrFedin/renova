import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Stack } from 'expo-router';
import { useRenova } from '@/lib/context/RenovaContext';
import { api } from '@/lib/api';
import { RenovaTheme } from '@/constants/Theme';

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  const w = max ? Math.round((value / max) * 100) : 0;
  return (<View style={st.barRow}><Text style={st.lbl}>{label}</Text><View style={st.track}><View style={[st.fill, { width: `${w}%` }]} /></View><Text>{value}</Text></View>);
}

export default function AdminDashboardWeb() {
  const { user } = useRenova();
  const [s, setS] = useState<any>(null);
  const [rev, setRev] = useState<any[]>([]);
  const [health, setHealth] = useState<any>(null);
  const [chart, setChart] = useState<any[]>([]);
  useEffect(() => { if (user) api.getAdminStats(user.id).then(setS);
    api.getProjectsChart(user.id).then(setChart);
    api.getRevenueChart(user.id).then(setRev);
    api.getReleaseHealth(user.id).then(setHealth); }, [user?.id]);
  if (Platform.OS !== 'web') return null;
  const max = Math.max(s?.projects || 1, s?.users || 1, s?.audit_events || 1);
  return (<><Stack.Screen options={{ title: 'Панель' }} /><View style={st.wrap}>
    {health && <Text style={{marginBottom:8}}>Релиз: {health.crash_free_rate}% без сбоев</Text>}
    {rev.map((p) => (<Bar key={p.name+'r'} label={`${p.name} ₽`} value={p.margin} max={Math.max(...rev.map(x=>x.planned),1)} />))}
    {chart.map((p) => (<Bar key={p.name} label={p.name} value={p.progress} max={100} />))}
    {s && <><Bar label="Проекты" value={s.projects} max={max} /><Bar label="Пользователи" value={s.users} max={max} /><Bar label="Аудит" value={s.audit_events} max={max} /></>}
  </View></>);
}
const st = StyleSheet.create({
  wrap: { padding: 16, backgroundColor: RenovaTheme.colors.background, flex: 1 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  lbl: { width: 70, fontSize: 12 }, track: { flex: 1, height: 12, backgroundColor: RenovaTheme.colors.border, borderRadius: 6, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: RenovaTheme.colors.primary },
});
