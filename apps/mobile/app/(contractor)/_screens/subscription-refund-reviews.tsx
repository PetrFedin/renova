import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme, card, formatRub } from '@/constants/Theme';
import { api, ApiError, type SubscriptionRefundReview, type SubscriptionRefundResolutionAction } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { reportError } from '@/lib/reportError';

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return 'Операционный доступ запрещён для этой учётной записи.';
    if (error.status === 409) return 'Очередь уже изменилась. Обновите данные и повторите решение.';
    if (error.status === 422) return 'Решение не прошло проверку целостности. Проверьте связанный checkout.';
  }
  return error instanceof Error ? error.message : 'Не удалось обработать возврат.';
}

function decisionKey(item: SubscriptionRefundReview, action: SubscriptionRefundResolutionAction): string {
  return `ops-${Date.now().toString(36)}-${item.review_version}-${action.slice(0, 12)}`;
}

export default function SubscriptionRefundReviewsScreen() {
  const { user } = useRenova();
  const [items, setItems] = useState<SubscriptionRefundReview[]>([]);
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
      const result = await api.listSubscriptionRefundReviews(user.id, 'actionable');
      setItems(result.items);
      setTotal(result.total);
    } catch (cause) {
      reportError('admin.subscriptionRefundReviews.load', cause);
      setError(errorText(cause));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => { void load(); }, [load]);

  const run = useCallback(async (item: SubscriptionRefundReview, action: 'claim' | 'release' | SubscriptionRefundResolutionAction) => {
    if (!user?.id) return;
    setBusyId(item.id);
    setError(null);
    setNotice(null);
    try {
      if (action === 'claim') {
        await api.claimSubscriptionRefundReview(user.id, item.id, item.review_version);
        setNotice('Возврат закреплён за вами для решения.');
      } else if (action === 'release') {
        await api.releaseSubscriptionRefundReview(user.id, item.id, item.review_version);
        setNotice('Возврат возвращён в общую очередь.');
      } else {
        await api.resolveSubscriptionRefundReview(user.id, item.id, {
          expectedVersion: item.review_version,
          action,
          checkoutId: action === 'link_and_apply' ? item.checkout_id ?? null : null,
          decisionKey: decisionKey(item, action),
          note: action === 'dismiss_duplicate'
            ? 'Закрыто в Operations Center как дублирующий возврат.'
            : action === 'dismiss_not_subscription'
              ? 'Закрыто в Operations Center: возврат не относится к подписке.'
              : 'Связанный checkout подтверждён в Operations Center; возврат применён к entitlement.',
        });
        setNotice(action === 'link_and_apply' ? 'Возврат применён к связанной подписке.' : 'Ручная проверка закрыта.');
      }
      await load(true);
    } catch (cause) {
      reportError('admin.subscriptionRefundReviews.action', cause, { refundId: item.id, action });
      setError(errorText(cause));
      await load(true);
    } finally {
      setBusyId(null);
    }
  }, [load, user?.id]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <BackHeader title="Возвраты подписки" />
      <ScrollView
        style={s.screen}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />}
      >
        <View style={s.hero}>
          <Text style={s.title}>Ручная проверка возвратов</Text>
          <Text style={s.sub}>Только неоднозначные возвраты. Администратор может отклонить ошибочную запись или применить её к уже существующему подтверждённому checkout.</Text>
          <Text style={s.metric}>{total} требуют решения</Text>
        </View>

        {error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : null}
        {notice ? <Text style={s.notice}>{notice}</Text> : null}
        {loading ? <View style={s.loading}><ActivityIndicator color={RenovaTheme.colors.primary} /><Text style={s.muted}>Загрузка…</Text></View> : null}
        {!loading && !items.length ? <View style={s.empty}><Text style={s.emptyTitle}>Очередь пуста</Text><Text style={s.muted}>Неоднозначных возвратов подписки нет.</Text></View> : null}

        {items.map((item) => {
          const ownedByMe = item.effective_review_status === 'claimed' && item.review_owner_id === user?.id;
          const claimedByOther = item.effective_review_status === 'claimed' && !ownedByMe;
          const busy = busyId === item.id;
          return (
            <View key={item.id} style={s.card}>
              <View style={s.rowBetween}>
                <View style={{ flex: 1 }}>
                  <Text style={s.cardTitle}>{formatRub(Number(item.amount || 0))} · {item.currency || 'RUB'}</Text>
                  <Text style={s.meta}>Причина: {item.reason || 'не указана'}</Text>
                </View>
                <Text style={claimedByOther ? s.badgeBad : ownedByMe ? s.badgeMine : s.badge}>{item.effective_review_status}</Text>
              </View>
              <Text style={s.meta}>Refund: {item.provider_refund_id || item.id}</Text>
              <Text style={s.meta}>Checkout: {item.checkout_id || 'не связан'}</Text>
              <Text style={s.meta}>Версия решения: {item.review_version}</Text>

              {!claimedByOther && !ownedByMe ? (
                <PrimaryButton title="Взять в работу" size="sm" loading={busy} disabled={busyId !== null} onPress={() => void run(item, 'claim')} />
              ) : null}
              {ownedByMe ? (
                <View style={s.actions}>
                  {item.checkout_id ? (
                    <PrimaryButton title="Связать и применить" size="sm" disabled={busyId !== null} loading={busy} onPress={() => void run(item, 'link_and_apply')} />
                  ) : null}
                  <PrimaryButton title="Не относится к подписке" variant="outline" size="sm" disabled={busyId !== null} onPress={() => void run(item, 'dismiss_not_subscription')} />
                  <PrimaryButton title="Дубликат" variant="outline" size="sm" disabled={busyId !== null} onPress={() => void run(item, 'dismiss_duplicate')} />
                  <PrimaryButton title="Освободить" variant="outline" size="sm" disabled={busyId !== null} onPress={() => void run(item, 'release')} />
                </View>
              ) : null}
              {claimedByOther ? <Text style={s.muted}>Возврат уже находится в работе у другого администратора.</Text> : null}
            </View>
          );
        })}
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
  cardTitle: { fontSize: 15, fontWeight: '700', color: RenovaTheme.colors.text },
  meta: { fontSize: 12, color: RenovaTheme.colors.textMuted },
  badge: { fontSize: 11, fontWeight: '700', color: RenovaTheme.colors.textMuted },
  badgeMine: { fontSize: 11, fontWeight: '800', color: RenovaTheme.colors.successText },
  badgeBad: { fontSize: 11, fontWeight: '800', color: RenovaTheme.colors.warning },
  actions: { gap: 8, marginTop: 4 },
  error: { padding: 10, borderRadius: 8, backgroundColor: RenovaTheme.colors.dangerBg, color: RenovaTheme.colors.dangerText },
  notice: { padding: 10, borderRadius: 8, backgroundColor: RenovaTheme.colors.successBg, color: RenovaTheme.colors.successText },
  loading: { alignItems: 'center', gap: 8, padding: 20 },
  empty: { ...card, alignItems: 'center', gap: 4 },
  emptyTitle: { fontWeight: '700', color: RenovaTheme.colors.text },
  muted: { color: RenovaTheme.colors.textMuted },
});
