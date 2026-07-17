/** P2.1 Web client portal — read-only по magic link ?token= */
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RenovaTheme, formatRub, card } from '@/constants/Theme';
import { api } from '@/lib/api';

const PORTAL_USER_KEY = 'renova:portal:user';

export default function PortalScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<{ user_id: string; project_id: string; project_name: string } | null>(null);
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof api.portalSnapshot>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tok = typeof token === 'string' ? token : '';
        if (!tok) {
          Alert.alert('Портал', 'Нужна ссылка с token');
          return;
        }
        const sess = await api.exchangePortalToken(tok);
        await AsyncStorage.setItem(PORTAL_USER_KEY, sess.user_id);
        if (cancelled) return;
        setSession(sess);
        const snap = await api.portalSnapshot(sess.user_id, sess.project_id);
        if (!cancelled) setSnapshot(snap);
      } catch {
        if (!cancelled) Alert.alert('Портал', 'Ссылка недействительна или истекла');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={RenovaTheme.colors.primary} />
        <Text style={s.muted}>Открываем портал…</Text>
      </View>
    );
  }

  if (!session || !snapshot) {
    return (
      <View style={s.center}>
        <Text style={s.title}>Портал Renova</Text>
        <Text style={s.muted}>Не удалось загрузить объект</Text>
      </View>
    );
  }

  const sched = snapshot.schedule as { current_stage?: string; progress_percent?: number; planned_end?: string };

  return (
    <ScrollView style={s.wrap} contentContainerStyle={s.content}>
      <Text style={s.brand}>Renova · портал заказчика</Text>
      <Text style={s.title}>{snapshot.project.name}</Text>
      {snapshot.project.address ? <Text style={s.muted}>{snapshot.project.address}</Text> : null}
      <Text style={s.ro}>Только просмотр · {session.project_name}</Text>

      <View style={s.card}>
        <Text style={s.cardHead}>Расписание</Text>
        <Text style={s.line}>Этап: {sched.current_stage || '—'}</Text>
        <Text style={s.line}>Прогресс: {sched.progress_percent ?? snapshot.project.progress_percent ?? 0}%</Text>
        {sched.planned_end ? <Text style={s.line}>План окончания: {sched.planned_end}</Text> : null}
      </View>

      <View style={s.card}>
        <Text style={s.cardHead}>Ожидают оплаты ({snapshot.pending_payments.length})</Text>
        {snapshot.pending_payments.length === 0 ? (
          <Text style={s.muted}>Нет счетов</Text>
        ) : (
          snapshot.pending_payments.map((p) => (
            <Text key={p.id} style={s.line}>{p.title} · {formatRub(p.amount)}</Text>
          ))
        )}
      </View>

      <View style={s.card}>
        <Text style={s.cardHead}>Документы ({snapshot.documents_total})</Text>
        {snapshot.documents.slice(0, 8).map((d) => (
          <Text key={d.id} style={s.line}>{d.title}</Text>
        ))}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  content: { padding: 20, paddingBottom: 40, gap: 12 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  brand: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.primary, textTransform: 'uppercase' },
  title: { fontSize: 24, fontWeight: '800', color: RenovaTheme.colors.text },
  muted: { fontSize: 14, color: RenovaTheme.colors.textMuted },
  ro: { fontSize: 12, color: RenovaTheme.colors.warning, fontWeight: '600', marginBottom: 8 },
  card: { ...card, gap: 6 },
  cardHead: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  line: { fontSize: 14, color: RenovaTheme.colors.text },
});
