import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Stack } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import { useRenova } from '@/lib/context/RenovaContext';
import { api } from '@/lib/api';
import { RenovaTheme } from '@/constants/Theme';

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  const w = max ? Math.round((value / max) * 100) : 0;
  return (
    <View style={st.barRow}>
      <Text style={st.lbl}>{label}</Text>
      <View style={st.track}>
        <View style={[st.fill, { width: `${w}%` }]} />
      </View>
      <Text>{value}</Text>
    </View>
  );
}

/** P3-W39: один файл (раньше .tsx + .web.tsx) */
export default function AdminDashboardScreen() {
  const { user } = useRenova();
  const [s, setS] = useState<any>(null);
  const [rev, setRev] = useState<any[]>([]);
  const [health, setHealth] = useState<any>(null);
  const [yk, setYk] = useState<any>(null);
  const [fns, setFns] = useState<any>(null);
  const [chart, setChart] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;
    api.getAdminStats(user.id).then(setS).catch(() => {});
    api.getReleaseHealth(user.id).then(setHealth).catch(() => {});
    api.getYookassaHealth(user.id).then(setYk).catch(() => {});
    api.getFnsHealth(user.id).then(setFns).catch(() => {});
    if (Platform.OS === 'web') {
      api.getProjectsChart(user.id).then(setChart).catch(() => {});
      api.getRevenueChart(user.id).then(setRev).catch(() => {});
    }
  }, [user?.id]);

  if (Platform.OS !== 'web') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <BackHeader title="Панель администратора" />
        <View style={st.nativeWrap}>
          <Text style={st.title}>Панель</Text>
          <Text style={st.sub}>Полная версия доступна в web-превью (desktop).</Text>
          {s ? (
            <>
              <Text style={st.row}>Проекты: {s.projects}</Text>
              <Text style={st.row}>Пользователи: {s.users}</Text>
            </>
          ) : null}

        {yk ? (
          <Text style={st.sub}>
            ЮKassa: {yk.configured ? 'ключи заданы' : 'нет ключей'}
            {yk.live_checkout_ready ? ' · live ready' : ''}
            {yk.demo_allowed ? ' · demo OK' : ''}
            {yk.hint ? ` · ${yk.hint}` : ''}
          </Text>
        ) : null}
        {health?.integrations ? (
          <Text style={st.sub}>
            SMTP: {health.integrations.smtp?.configured ? 'on' : 'off'}
            {' · '}worker: {health.integrations.automation_worker?.healthy ? 'ok' : 'alert'}
            {health.integrations.fns ? ` · ФНС live: ${health.integrations.fns.live_verify_ready ? 'yes' : 'no'}` : ''}
          </Text>
        ) : null}

        {fns ? (
          <Text style={st.sub}>
            ФНС чеки: {fns.receipt_auth_configured ? 'auth OK' : 'без auth'}
            {fns.live_verify_ready ? ' · live ready' : ''}
            {fns.demo_verify_allowed ? ' · demo OK' : ''}
          </Text>
        ) : null}
        </View>
      </>
    );
  }

  const max = Math.max(s?.projects || 1, s?.users || 1, s?.audit_events || 1);
  return (
    <>
      <Stack.Screen options={{ title: 'Панель' }} />
      <View style={st.wrap}>
        {health ? <Text style={{ marginBottom: 8 }}>Релиз: {health.crash_free_rate}% без сбоев</Text> : null}
        {yk ? (
          <Text style={st.sub}>
            ЮKassa: {yk.configured ? 'ключи заданы' : 'нет ключей'}
            {yk.live_checkout_ready ? ' · live ready' : ''}
            {yk.demo_allowed ? ' · demo OK' : ''}
            {yk.hint ? ` · ${yk.hint}` : ''}
          </Text>
        ) : null}
        {health?.integrations ? (
          <Text style={st.sub}>
            SMTP: {health.integrations.smtp?.configured ? 'on' : 'off'}
            {' · '}worker: {health.integrations.automation_worker?.healthy ? 'ok' : 'alert'}
            {health.integrations.fns ? ` · ФНС live: ${health.integrations.fns.live_verify_ready ? 'yes' : 'no'}` : ''}
          </Text>
        ) : null}

        {fns ? (
          <Text style={st.sub}>
            ФНС чеки: {fns.receipt_auth_configured ? 'auth OK' : 'без auth'}
            {fns.live_verify_ready ? ' · live ready' : ''}
            {fns.demo_verify_allowed ? ' · demo OK' : ''}
          </Text>
        ) : null}

        {rev.map((p) => (
          <Bar key={`${p.name}r`} label={`${p.name} ₽`} value={p.margin} max={Math.max(...rev.map((x) => x.planned), 1)} />
        ))}
        {chart.map((p) => (
          <Bar key={p.name} label={p.name} value={p.progress} max={100} />
        ))}
        {s ? (
          <>
            <Bar label="Проекты" value={s.projects} max={max} />
            <Bar label="Пользователи" value={s.users} max={max} />
            <Bar label="Аудит" value={s.audit_events} max={max} />
          </>
        ) : null}
      </View>
    </>
  );
}

const st = StyleSheet.create({
  wrap: { padding: 16, backgroundColor: RenovaTheme.colors.background, flex: 1 },
  nativeWrap: { flex: 1, padding: 24, backgroundColor: RenovaTheme.colors.background },
  title: { fontSize: 20, fontWeight: '800', marginBottom: 8 },
  sub: { color: RenovaTheme.colors.textMuted, marginBottom: 12 },
  row: { fontSize: 16, marginBottom: 8, fontWeight: '600' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  lbl: { width: 70, fontSize: 12 },
  track: { flex: 1, height: 12, backgroundColor: RenovaTheme.colors.border, borderRadius: 6, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: RenovaTheme.colors.primary },
});
