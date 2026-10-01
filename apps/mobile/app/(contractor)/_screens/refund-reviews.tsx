/** Админ: ручной разбор возвратов подписки (MKT-033). Доступ — только через AdminGate. */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BackHeader } from '@/components/renova/BackHeader';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme, card, formatRub } from '@/constants/Theme';
import { api } from '@/lib/api';
import type { RefundResolveAction, RefundReviewItem } from '@/lib/api/teamOps';
import { useRenova } from '@/lib/context/RenovaContext';
import { makeDecisionKey, refundActions, refundErrorMessage } from '@/lib/domain/refundReview';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { reportError } from '@/lib/reportError';

function RefundCard({ item, adminId, onChanged }: { item: RefundReviewItem; adminId: string; onChanged: () => void }) {
  const [note, setNote] = useState('');
  const [checkoutId, setCheckoutId] = useState('');
  const [busy, setBusy] = useState(false);
  const actions = refundActions(item, adminId);

  const run = async (fn: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    try {
      await fn();
      setNote('');
      onChanged();
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      showActionConfirm({ title: 'Не выполнено', message: refundErrorMessage(code, e instanceof Error && e.message ? e.message : failure) });
    } finally {
      setBusy(false);
    }
  };

  const resolve = (action: RefundResolveAction) =>
    run(
      () =>
        api.resolveRefundReview(adminId, item.id, {
          expected_version: item.review_version,
          decision_key: makeDecisionKey(item.id, action, Date.now()),
          action,
          note: note.trim(),
          ...(action === 'link_and_apply' ? { checkout_id: checkoutId.trim() } : {}),
        }),
      'Не удалось закрыть случай',
    );

  return (
    <View style={s.card}>
      <Text style={s.title}>{formatRub(item.amount)} · {item.status}</Text>
      <Text style={s.meta}>
        Статус: {item.effective_review_status}
        {item.review_owner_id ? (item.review_owner_id === adminId ? ' · у вас' : ' · у другого администратора') : ''}
      </Text>
      {item.reason ? <Text style={s.meta}>Причина: {item.reason}</Text> : null}
      {actions.canClaim ? (
        <PrimaryButton
          title="Взять в работу"
          size="sm"
          disabled={busy}
          onPress={() => run(() => api.claimRefundReview(adminId, item.id, item.review_version), 'Не удалось взять в работу')}
        />
      ) : null}
      {actions.canRelease || actions.canDismiss || actions.canLink ? (
        <>
          <TextInput
            style={s.input}
            placeholder="Комментарий к решению (от 10 символов)"
            value={note}
            onChangeText={setNote}
            multiline
          />
          {actions.canRelease ? (
            <PrimaryButton
              title="Отпустить"
              variant="outline"
              size="sm"
              disabled={busy}
              onPress={() => run(() => api.releaseRefundReview(adminId, item.id, item.review_version), 'Не удалось отпустить')}
            />
          ) : null}
          {actions.canDismiss ? (
            <>
              <PrimaryButton title="Закрыть: не подписка" variant="outline" size="sm" disabled={busy || note.trim().length < 10} onPress={() => resolve('dismiss_not_subscription')} />
              <PrimaryButton title="Закрыть: дубль" variant="outline" size="sm" disabled={busy || note.trim().length < 10} onPress={() => resolve('dismiss_duplicate')} />
            </>
          ) : null}
          {actions.canLink ? (
            <>
              <TextInput style={s.input} placeholder="ID покупки (checkout)" value={checkoutId} onChangeText={setCheckoutId} autoCapitalize="none" />
              <PrimaryButton
                title="Подтвердить привязку к покупке"
                size="sm"
                disabled={busy || note.trim().length < 10 || !checkoutId.trim()}
                onPress={() => resolve('link_and_apply')}
              />
            </>
          ) : null}
        </>
      ) : null}
      {actions.linkBlockedReason ? <Text style={s.hint}>{actions.linkBlockedReason}</Text> : null}
    </View>
  );
}

export default function RefundReviewsScreen() {
  const { user } = useRenova();
  const [items, setItems] = useState<RefundReviewItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const res = await api.listRefundReviews(user.id);
      setItems(res.items);
      setFailed(false);
    } catch (e) {
      reportError('refundReviews.load', e);
      setFailed(true);
    }
  }, [user?.id]);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <BackHeader title="Возвраты подписки" />
      <ScrollView
        style={s.wrap}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        <Text style={s.hint}>
          Привязку возврата к покупке (с отзывом Pro) утверждает второй администратор: тот, кто взял случай в работу, подтвердить её не может.
        </Text>
        {failed && !items ? (
          <>
            <Text style={s.meta}>Не удалось загрузить очередь.</Text>
            <PrimaryButton title="Повторить" variant="outline" onPress={load} />
          </>
        ) : items === null ? (
          <ActivityIndicator />
        ) : items.length === 0 ? (
          <Text style={s.meta}>Нет возвратов, требующих ручного разбора.</Text>
        ) : (
          user && items.map((it) => <RefundCard key={`${it.id}:${it.review_version}`} item={it} adminId={user.id} onChanged={load} />)
        )}
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, padding: 16, backgroundColor: RenovaTheme.colors.background },
  card: { ...card, gap: 8, marginBottom: 10 },
  title: { fontWeight: '800', fontSize: 15, color: RenovaTheme.colors.text },
  meta: { fontSize: 13, color: RenovaTheme.colors.textMuted },
  hint: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 8, lineHeight: 17 },
  input: { borderWidth: 1, borderColor: RenovaTheme.colors.border, borderRadius: 10, padding: 10, backgroundColor: RenovaTheme.colors.surface },
});
