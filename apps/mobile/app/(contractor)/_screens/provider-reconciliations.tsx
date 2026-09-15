import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme, card } from '@/constants/Theme';
import { api, ApiError, type ProviderReconciliationItem } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { reportError } from '@/lib/reportError';

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return 'Операционный доступ запрещён для этой учётной записи.';
    if (error.status === 409) return 'Состояние сверки изменилось. Обновите список и повторите действие.';
  }
  return error instanceof Error ? error.message : 'Не удалось загрузить сверки провайдеров.';
}

function short(value?: string | null): string {
  if (!value) return '—';
  return value.length > 24 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

export default function ProviderReconciliationsScreen() {
  const { user } = useRenova();
  const [items, setItems] = useState<ProviderReconciliationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (!user?.id) return;
    refresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const result = await api.listProviderReconciliations(user.id, { limit: 100 });
      setItems(result.items);
      setTotal(result.total);
    } catch (cause) {
      reportError('admin.providerReconciliations.load', cause);
      setError(errorText(cause));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => { void load(); }, [load]);

  const requeue = useCallback(async (item: ProviderReconciliationItem) => {
    if (!user?.id || !item.recoverable) return;
    setBusyId(item.id);
    setError(null);
    setNotice(null);
    try {
      await api.requeueProviderReconciliation(user.id, item.id);
      setNotice(`Сверка ${item.provider} поставлена на безопасный повтор.`);
      await load(true);
    } catch (cause) {
      reportError('admin.providerReconciliations.requeue', cause, { reconciliationId: item.id });
      setError(errorText(cause));
      await load(true);
    } finally {
      setBusyId(null);
    }
  }, [load, user?.id]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <BackHeader title="Сверки провайдеров" />
      <ScrollView
        style={s.screen}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />}
      >
        <View style={s.hero}>
          <Text style={s.title}>Provider reconciliation</Text>
          <Text style={s.sub}>Ошибки внешних провайдеров, которые требуют безопасного повторного чтения или сверки. Секреты и raw payload здесь не отображаются.</Text>
          <Text style={s.metric}>{total} требуют внимания</Text>
        </View>

        {error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : null}
        {notice ? <Text style={s.notice}>{notice}</Text> : null}
        {loading ? <View style={s.loading}><ActivityIndicator color={RenovaTheme.colors.primary} /><Text style={s.muted}>Загрузка…</Text></View> : null}
        {!loading && !items.length ? <View style={s.empty}><Text style={s.emptyTitle}>Проблемных сверок нет</Text><Text style={s.muted}>Worker не оставил terminal/unavailable операций.</Text></View> : null}

        {items.map((item) => (
          <View key={item.id} style={s.card}>
            <View style={s.rowBetween}>
              <Text style={s.cardTitle}>{item.provider} · {item.operation_type}</Text>
              <Text style={item.recoverable ? s.badgeBad : s.badge}>{item.status}</Text>
            </View>
            <Text style={s.meta}>{item.resource_type} · {short(item.resource_id)}</Text>
            <Text style={s.meta}>Попыток: {item.attempts}{item.provider_status ? ` · provider: ${item.provider_status}` : ''}</Text>
            {item.error_code ? <Text style={s.meta}>Код: {item.error_code}{item.error_fingerprint ? ` · ${short(item.error_fingerprint)}` : ''}</Text> : null}
            {item.updated_at ? <Text style={s.meta}>Обновлено: {new Date(item.updated_at).toLocaleString()}</Text> : null}
            {item.recoverable ? (
              <PrimaryButton
                title="Повторить сверку"
                variant="outline"
                size="sm"
                loading={busyId === item.id}
                disabled={busyId !== null}
                onPress={() => void requeue(item)}
              />
            ) : null}
          </View>
        ))}
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  content: { padding: 16, paddingBottom: 32, gap: 12 },
  hero: { ...card, gap: 6 },
  title: { fontSize: 20, fontWeight: '800', color: RenovaTheme.colors.text },
  sub: { color: RenovaTheme.colors.textMuted, lineHeight: 19 },
  metric: { marginTop: 4, fontWeight: '700', color: RenovaTheme.colors.text },
  card: { ...card, gap: 7 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: RenovaTheme.colors.text },
  badge: { fontSize: 11, fontWeight: '700', color: RenovaTheme.colors.textMuted },
  badgeBad: { fontSize: 11, fontWeight: '800', color: RenovaTheme.colors.dangerText },
  meta: { fontSize: 12, color: RenovaTheme.colors.textMuted },
  error: { padding: 10, borderRadius: 8, backgroundColor: RenovaTheme.colors.dangerBg, color: RenovaTheme.colors.dangerText },
  notice: { padding: 10, borderRadius: 8, backgroundColor: RenovaTheme.colors.successBg, color: RenovaTheme.colors.successText },
  loading: { alignItems: 'center', gap: 8, padding: 20 },
  empty: { ...card, alignItems: 'center', gap: 4 },
  emptyTitle: { fontWeight: '700', color: RenovaTheme.colors.text },
  muted: { color: RenovaTheme.colors.textMuted },
});
