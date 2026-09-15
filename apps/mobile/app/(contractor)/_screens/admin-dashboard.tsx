import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, Platform } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useRenova } from '@/lib/context/RenovaContext';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { api } from '@/lib/api';
import { RenovaTheme, card } from '@/constants/Theme';
import { reportCatch } from '@/lib/reportError';

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  const w = max ? Math.round((value / max) * 100) : 0;
  return (
    <View style={st.barRow}>
      <Text style={st.lbl}>{label}</Text>
      <View style={st.track}><View style={[st.fill, { width: `${w}%` }]} /></View>
      <Text>{value}</Text>
    </View>
  );
}

function OperationsCenter({
  health,
  onOutbox,
  onReconciliation,
  onRefunds,
}: {
  health: any;
  onOutbox: () => void;
  onReconciliation: () => void;
  onRefunds: () => void;
}) {
  const outbox = health?.integrations?.outbox;
  const reconciliation = health?.integrations?.provider_reconciliation;
  const worker = health?.integrations?.automation_worker;
  const poisoned = Number(outbox?.poisoned || 0);
  const stale = Number(outbox?.stale_leases || 0);
  const terminal = Number(reconciliation?.terminal_total || 0);
  const pending = Number(reconciliation?.pending_total || 0);
  const workerHealthy = Boolean(worker?.healthy);
  const hasCritical = poisoned > 0 || stale > 0 || terminal > 0 || !workerHealthy;

  return (
    <View style={[st.ops, hasCritical ? st.opsCritical : st.opsHealthy]}>
      <View style={st.opsHeader}>
        <View style={{ flex: 1 }}>
          <Text style={st.opsTitle}>Operations Center</Text>
          <Text style={st.opsText}>Внутренний контур RENOVA: проблемные платежи/события, сверки провайдеров, возвраты подписки и состояние worker.</Text>
        </View>
        <Text style={hasCritical ? st.badgeCritical : st.badgeHealthy}>{hasCritical ? 'ACTION' : 'OK'}</Text>
      </View>

      <View style={st.opsMetrics}>
        <View style={st.opsMetric}><Text style={st.opsN}>{poisoned}</Text><Text style={st.opsLabel}>DLQ</Text></View>
        <View style={st.opsMetric}><Text style={st.opsN}>{terminal}</Text><Text style={st.opsLabel}>provider</Text></View>
        <View style={st.opsMetric}><Text style={st.opsN}>{pending}</Text><Text style={st.opsLabel}>retry</Text></View>
        <View style={st.opsMetric}><Text style={st.opsN}>{workerHealthy ? 'OK' : '!'}</Text><Text style={st.opsLabel}>worker</Text></View>
      </View>

      <View style={st.opsActions}>
        <PrimaryButton title={poisoned || stale ? 'Проблемные платежи и события' : 'Очередь событий'} variant={poisoned || stale ? 'danger' : 'outline'} size="sm" onPress={onOutbox} />
        <PrimaryButton title="Сверки провайдеров" variant={terminal ? 'danger' : 'outline'} size="sm" onPress={onReconciliation} />
        <PrimaryButton title="Возвраты подписки" variant="outline" size="sm" onPress={onRefunds} />
      </View>
    </View>
  );
}

/** Внутренний Operations Center доступен только административной identity backend. */
export default function AdminDashboardScreen() {
  const { user } = useRenova();
  const router = useRouter();
  const [stats, setStats] = useState<any>(null);
  const [revenue, setRevenue] = useState<any[]>([]);
  const [health, setHealth] = useState<any>(null);
  const [yk, setYk] = useState<any>(null);
  const [fns, setFns] = useState<any>(null);
  const [h0, setH0] = useState<any>(null);
  const [chart, setChart] = useState<any[]>([]);

  const reload = useCallback(() => {
    if (!user) return;
    api.getAdminStats(user.id).then(setStats).catch(reportCatch('app.contractor._screens.admindashboard.stats'));
    api.getReleaseHealth(user.id).then(setHealth).catch(reportCatch('app.contractor._screens.admindashboard.health'));
    api.getYookassaHealth(user.id).then(setYk).catch(reportCatch('app.contractor._screens.admindashboard.yookassa'));
    api.getFnsHealth(user.id).then(setFns).catch(reportCatch('app.contractor._screens.admindashboard.fns'));
    api.getH0Readiness(user.id).then(setH0).catch(reportCatch('app.contractor._screens.admindashboard.h0'));
    if (Platform.OS === 'web') {
      api.getProjectsChart(user.id).then(setChart).catch(reportCatch('app.contractor._screens.admindashboard.projects'));
      api.getRevenueChart(user.id).then(setRevenue).catch(reportCatch('app.contractor._screens.admindashboard.revenue'));
    }
  }, [user?.id]);

  useEffect(() => { reload(); }, [reload]);
  useProjectDataReload(reload);

  const go = useCallback((path: string) => router.push(path as never), [router]);
  const max = Math.max(stats?.projects || 1, stats?.users || 1, stats?.audit_events || 1);

  const body = (
    <ScrollView style={st.wrap} contentContainerStyle={st.content}>
      <OperationsCenter
        health={health}
        onOutbox={() => go('/(contractor)/outbox-dead-letters')}
        onReconciliation={() => go('/(contractor)/provider-reconciliations')}
        onRefunds={() => go('/(contractor)/subscription-refund-reviews')}
      />

      <View style={st.sectionCard}>
        <Text style={st.sectionTitle}>Runtime / providers</Text>
        <Text style={st.sub}>Релиз: {health ? `${health.crash_free_rate}% без сбоев` : 'загрузка…'}</Text>
        <Text style={st.sub}>Worker: {health?.integrations?.automation_worker?.healthy ? 'healthy' : 'attention'} · status {health?.integrations?.automation_worker?.status || '—'}</Text>
        <Text style={st.sub}>ЮKassa: {yk?.configured ? 'ключи заданы' : 'нет ключей'}{yk?.live_checkout_ready ? ' · live ready' : ''}{yk?.demo_allowed ? ' · demo OK' : ''}</Text>
        <Text style={st.sub}>ФНС: {fns?.receipt_auth_configured ? 'auth OK' : 'без auth'}{fns?.live_verify_ready ? ' · live ready' : ''}{fns?.demo_verify_allowed ? ' · demo OK' : ''}</Text>
        <Text style={st.sub}>SMTP: {health?.integrations?.smtp?.configured ? 'on' : 'off'} · Kontur: {health?.integrations?.esign?.kontur_mode || 'off'}</Text>
      </View>

      {h0 ? (
        <View style={st.sectionCard}>
          <Text style={st.sectionTitle}>Готовность стенда</Text>
          <Text style={st.sub}>Investor demo: {h0.ready_for_investor_demo ? 'READY' : 'NOT READY'} · score {h0.score}%</Text>
          {h0.blockers?.length ? <Text style={st.sub}>Blockers: {h0.blockers.map((b: { id: string }) => b.id).join(', ')}</Text> : null}
          {h0.hint ? <Text style={st.sub}>{h0.hint}</Text> : null}
        </View>
      ) : null}

      {Platform.OS === 'web' ? (
        <View style={st.sectionCard}>
          <Text style={st.sectionTitle}>Платформа</Text>
          {revenue.map((p) => <Bar key={`${p.name}r`} label={`${p.name} ₽`} value={p.margin} max={Math.max(...revenue.map((x) => x.planned), 1)} />)}
          {chart.map((p) => <Bar key={p.name} label={p.name} value={p.progress} max={100} />)}
          {stats ? (
            <>
              <Bar label="Проекты" value={stats.projects} max={max} />
              <Bar label="Пользователи" value={stats.users} max={max} />
              <Bar label="Аудит" value={stats.audit_events} max={max} />
            </>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );

  if (Platform.OS !== 'web') {
    return <><Stack.Screen options={{ headerShown: false }} /><BackHeader title="Operations Center" />{body}</>;
  }
  return <><Stack.Screen options={{ title: 'Operations Center' }} />{body}</>;
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  content: { padding: 16, paddingBottom: 32, gap: 12 },
  ops: { ...card, borderWidth: 1, gap: 12 },
  opsCritical: { borderColor: RenovaTheme.colors.dangerBorder, backgroundColor: RenovaTheme.colors.dangerBg },
  opsHealthy: { borderColor: RenovaTheme.colors.successBorder, backgroundColor: RenovaTheme.colors.successBg },
  opsHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  opsTitle: { fontSize: 20, fontWeight: '800', color: RenovaTheme.colors.text },
  opsText: { marginTop: 4, color: RenovaTheme.colors.textMuted, lineHeight: 18 },
  badgeCritical: { color: RenovaTheme.colors.dangerText, fontWeight: '800', fontSize: 11 },
  badgeHealthy: { color: RenovaTheme.colors.successText, fontWeight: '800', fontSize: 11 },
  opsMetrics: { flexDirection: 'row', gap: 8 },
  opsMetric: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8, backgroundColor: RenovaTheme.colors.surface },
  opsN: { fontSize: 18, fontWeight: '800', color: RenovaTheme.colors.text },
  opsLabel: { fontSize: 10, color: RenovaTheme.colors.textMuted },
  opsActions: { gap: 8 },
  sectionCard: { ...card, gap: 6 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: RenovaTheme.colors.text, marginBottom: 4 },
  sub: { color: RenovaTheme.colors.textMuted, marginBottom: 4 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  lbl: { width: 70, fontSize: 12 },
  track: { flex: 1, height: 12, backgroundColor: RenovaTheme.colors.border, borderRadius: 6, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: RenovaTheme.colors.primary },
});
