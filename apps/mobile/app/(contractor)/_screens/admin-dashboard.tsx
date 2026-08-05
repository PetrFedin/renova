import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useRenova } from '@/lib/context/RenovaContext';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { api } from '@/lib/api';
import { RenovaTheme } from '@/constants/Theme';
import { reportCatch } from '@/lib/reportError';

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

function OutboxOperations({ health, onOpen }: { health: any; onOpen: () => void }) {
  const outbox = health?.integrations?.outbox;
  if (!outbox) return null;
  const poisoned = Number(outbox.poisoned || 0);
  const stale = Number(outbox.stale_leases || 0);
  const critical = poisoned > 0 || outbox.status === 'critical';
  return (
    <View style={[st.outboxCard, critical ? st.outboxCritical : st.outboxHealthy]}>
      <View style={st.outboxHeader}>
        <View style={st.outboxCopy}>
          <Text style={st.outboxTitle}>Доставка событий</Text>
          <Text style={st.outboxText}>
            {critical ? `Остановлено: ${poisoned}` : 'Poisoned-событий нет'}
            {stale ? ` · просроченных захватов: ${stale}` : ''}
          </Text>
        </View>
        <Text style={critical ? st.outboxCriticalLabel : st.outboxHealthyLabel}>
          {critical ? 'ACTION' : 'OK'}
        </Text>
      </View>
      <PrimaryButton
        title={critical ? 'Открыть восстановление' : 'Проверить очередь'}
        variant={critical ? 'danger' : 'outline'}
        size="sm"
        onPress={onOpen}
        accessibilityLabel="Открыть очередь восстановления событий"
      />
    </View>
  );
}

/** P3-W39: один файл (раньше .tsx + .web.tsx) */
export default function AdminDashboardScreen() {
  const { user } = useRenova();
  const router = useRouter();
  const [s, setS] = useState<any>(null);
  const [rev, setRev] = useState<any[]>([]);
  const [health, setHealth] = useState<any>(null);
  const [yk, setYk] = useState<any>(null);
  const [fns, setFns] = useState<any>(null);
  const [h0, setH0] = useState<any>(null);
  const [chart, setChart] = useState<any[]>([]);

  const reload = useCallback(() => {
    if (!user) return;
    api.getAdminStats(user.id).then(setS).catch(reportCatch('app.contractor._screens.admindashboard.1'));
    api.getReleaseHealth(user.id).then(setHealth).catch(reportCatch('app.contractor._screens.admindashboard.2'));
    api.getYookassaHealth(user.id).then(setYk).catch(reportCatch('app.contractor._screens.admindashboard.3'));
    api.getFnsHealth(user.id).then(setFns).catch(reportCatch('app.contractor._screens.admindashboard.4'));
    api.getH0Readiness(user.id).then(setH0).catch(reportCatch('app.contractor._screens.admindashboard.5'));
    if (Platform.OS === 'web') {
      api.getProjectsChart(user.id).then(setChart).catch(reportCatch('app.contractor._screens.admindashboard.6'));
      api.getRevenueChart(user.id).then(setRev).catch(reportCatch('app.contractor._screens.admindashboard.7'));
    }
  }, [user?.id]);
  useEffect(() => { reload(); }, [reload]);
  useProjectDataReload(reload);

  const openOutbox = useCallback(() => {
    router.push('/(contractor)/outbox-dead-letters' as never);
  }, [router]);

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
              {health.integrations.esign ? ` · Kontur: ${health.integrations.esign.kontur_mode}` : ''}
            </Text>
          ) : null}
          <OutboxOperations health={health} onOpen={openOutbox} />
          {h0 ? (
            <Text style={st.sub}>
              H0 investor: {h0.ready_for_investor_demo ? 'READY' : 'NOT READY'} · score {h0.score}%
              {h0.blockers?.length ? ` · blockers: ${h0.blockers.map((b: { id: string }) => b.id).join(', ')}` : ''}
              {h0.hint ? ` · ${h0.hint}` : ''}
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
        <OutboxOperations health={health} onOpen={openOutbox} />
        {yk ? (
          <Text style={st.sub}>
            ЮKassa: {yk.configured ? 'ключи заданы' : 'нет ключей'}
            {yk.live_checkout_ready ? ' · live ready' : ''}
            {yk.demo_allowed ? ' · demo OK' : ''}
            {yk.hint ? ` · ${yk.hint}` : ''}
          </Text>
        ) : null}
        {h0 ? (
          <Text style={st.sub}>
            H0 investor: {h0.ready_for_investor_demo ? 'READY' : 'NOT READY'} · score {h0.score}%
            {h0.blockers?.length ? ` · blockers: ${h0.blockers.map((b: { id: string }) => b.id).join(', ')}` : ''}
          </Text>
        ) : null}
        {health?.integrations ? (
          <Text style={st.sub}>
            SMTP: {health.integrations.smtp?.configured ? 'on' : 'off'}
            {' · '}worker: {health.integrations.automation_worker?.healthy ? 'ok' : 'alert'}
            {health.integrations.fns ? ` · ФНС live: ${health.integrations.fns.live_verify_ready ? 'yes' : 'no'}` : ''}
            {health.integrations.esign ? ` · Kontur: ${health.integrations.esign.kontur_mode}` : ''}
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
  outboxCard: { borderWidth: 1, borderRadius: RenovaTheme.radius.lg, padding: RenovaTheme.spacing.md, gap: RenovaTheme.spacing.sm, marginBottom: RenovaTheme.spacing.md },
  outboxCritical: { backgroundColor: RenovaTheme.colors.dangerBg, borderColor: RenovaTheme.colors.dangerBorder },
  outboxHealthy: { backgroundColor: RenovaTheme.colors.successBg, borderColor: RenovaTheme.colors.successBorder },
  outboxHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: RenovaTheme.spacing.md },
  outboxCopy: { flex: 1, gap: RenovaTheme.spacing.xs },
  outboxTitle: { fontSize: RenovaTheme.fontSize.h3, fontWeight: RenovaTheme.fontWeight.bold, color: RenovaTheme.colors.text },
  outboxText: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted },
  outboxCriticalLabel: { color: RenovaTheme.colors.dangerText, fontWeight: RenovaTheme.fontWeight.extrabold, fontSize: RenovaTheme.fontSize.tiny },
  outboxHealthyLabel: { color: RenovaTheme.colors.successText, fontWeight: RenovaTheme.fontWeight.extrabold, fontSize: RenovaTheme.fontSize.tiny },
});
