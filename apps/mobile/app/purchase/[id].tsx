/** Деталь закупки — статусы и позиции */
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { useWriteAllowed } from '@/components/renova/ReadOnlyGuard';
import { api, Purchase } from '@/lib/api';
import { RenovaTheme, card, formatRub } from '@/constants/Theme';
import { budgetTabRoute, calendarTabRoute, repairTabRoute } from '@/constants/osSections';
import { pushOsNav, replaceOsNav } from '@/lib/pushOsNav';
import { PURCHASE_NEXT_STATUS, purchaseAdvanceLabel, purchaseCancelAffectsFact, purchaseCancelLabel, purchaseCancelStatus, purchaseRoleMayCancel, purchaseRoleMayMove } from '@/lib/domain/purchaseLifecycle';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import { EmptyActionState } from '@/components/ui/EmptyActionState';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { alertPurchaseAdvanced } from '@/lib/procurementNav';
import { reportError } from '@/lib/reportError';
import { useBusyAction } from '@/lib/hooks/useBusyAction';

const ST: Record<string, string> = {
  draft: 'Черновик', approved: 'Согласовано', ordered: 'Заказано', paid: 'Оплачено',
  partial: 'Частично', delivered: 'Доставлено', cancelled: 'Отменено', returned: 'Возврат',
};

export default function PurchaseDetailScreen() {
  const { id, returnTo } = useLocalSearchParams<{ id: string; returnTo?: string }>();
  const { user, activeProject } = useRenova();
  const canWrite = useWriteAllowed();
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const role = user?.role === 'contractor' ? 'contractor' : 'customer';
  const advance = useBusyAction();

  const reload = useCallback(() => {
    if (!user || !activeProject || !id) return;
    api.listPurchases(user.id, activeProject.id).then((items) => {
      setPurchase(items.find((p) => p.id === id) || null);
      setLoadState('loaded');
    }).catch((e) => {
      reportError('app.purchase.[id].Purchase', e);
      // Сбой загрузки — не «закупки нет»: оставляем прежние данные, если они были
      setLoadState('error');
    });
  }, [user?.id, activeProject?.id, id]);

  useEffect(() => { reload(); }, [reload]);
  useProjectDataReload(reload);

  // REP-13: всегда с кнопкой «назад», различаем загрузку, сбой и «не найдено»
  if (!purchase) {
    return (
      <>
        <BackHeader title="Закупка" returnTo={returnTo} />
        {loadState === 'loading' ? (
          <LoadingState title="Загружаем закупку…" />
        ) : loadState === 'error' ? (
          <LoadErrorState
            title="Не удалось загрузить закупку"
            hint="Закупка не удалена — данные просто не загрузились. Проверьте сеть и повторите."
            onRetry={() => { setLoadState('loading'); reload(); }}
            role={role}
          />
        ) : (
          <EmptyActionState
            title="Закупка не найдена"
            hint="Возможно, она удалена или относится к другому объекту."
            icon="cart-outline"
            actionLabel="Все закупки"
            actionVariant="accent"
            onAction={() => replaceOsNav(repairTabRoute(role, 'materials'), returnTo || `/purchase/${id}`)}
          />
        )}
      </>
    );
  }

  const rawNext = PURCHASE_NEXT_STATUS[purchase.status];
  const next = rawNext && purchaseRoleMayMove(role, rawNext) ? rawNext : null;
  const rawCancel = purchaseCancelStatus(purchase.status);
  const cancel = rawCancel && purchaseRoleMayCancel(role, purchase.status) ? rawCancel : null;

  return (
    <>
      <BackHeader title={purchase.supplier_name || 'Закупка'} returnTo={returnTo} subtitle={ST[purchase.status] || purchase.status} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <View style={s.card}>
          <Text style={s.sum}>{formatRub(purchase.total_amount)}</Text>
          {purchase.ordered_at && <Text style={s.meta}>Заказ: {purchase.ordered_at.slice(0, 10)}</Text>}
          {purchase.delivered_at && <Text style={s.meta}>Доставка: {purchase.delivered_at.slice(0, 10)}</Text>}
        </View>
        <Text style={s.section}>Позиции</Text>
        {purchase.items.map((i) => (
          <View key={i.id} style={s.item}>
            <Text style={s.itemName}>{i.name}</Text>
            <Text style={s.meta}>{i.qty} {i.unit} · {formatRub(i.total)}</Text>
          </View>
        ))}
        {canWrite && next && user && activeProject && (
          <PrimaryButton
            title={purchaseAdvanceLabel(next)}
            loading={advance.busy}
            onPress={() => {
              void advance.run(async () => {
                await api.updatePurchaseStatus(user.id, activeProject.id, purchase.id, next);
                await syncProjectSideEffects({ user, project: activeProject });
                reload();
                // W128: lifecycle → факт / календарь
                alertPurchaseAdvanced(role, next);
              }, 'Статус закупки не изменён');
            }}
          />
        )}
        {canWrite && cancel && user && activeProject && (
          <PrimaryButton
            title={purchaseCancelLabel(purchase.status)}
            variant="dangerOutline"
            disabled={advance.busy}
            onPress={() => {
              const affectsFact = purchaseCancelAffectsFact(purchase.status);
              showActionConfirm({
                title: affectsFact ? 'Убрать из факта?' : 'Отменить закупку?',
                message: affectsFact
                  ? 'Сумма закупки выйдет из факта бюджета. Позиции и история закупки сохранятся.'
                  : 'Позиции освободятся и снова станут доступны для новой закупки.',
                primaryLabel: affectsFact ? 'Убрать' : 'Отменить закупку',
                primaryDestructive: true,
                onPrimary: () => {
                  void advance.run(async () => {
                    await api.updatePurchaseStatus(user.id, activeProject.id, purchase.id, cancel);
                    await syncProjectSideEffects({ user, project: activeProject });
                    reload();
                  }, 'Закупка не отменена');
                },
                secondaryLabel: 'Назад',
                onSecondary: () => undefined,
              });
            }}
          />
        )}
        {purchase.status === 'delivered' ? (
          <PrimaryButton
            title="Расходы бюджета"
            variant="outline"
            onPress={() => pushOsNav(budgetTabRoute(role, 'expenses'), returnTo || `/purchase/${id}`, role)}
          />
        ) : null}
        {(purchase.ordered_at || purchase.delivered_at) && (
          <PrimaryButton
            title="В календаре"
            variant="outline"
            onPress={() => pushOsNav(calendarTabRoute(role), returnTo || `/purchase/${id}`)}
          />
        )}
        <PrimaryButton title="Все закупки" variant="outline" onPress={() => replaceOsNav(repairTabRoute(role, 'materials'), returnTo || `/purchase/${id}`)} />
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { ...card, marginBottom: 12 },
  sum: { fontSize: 24, fontWeight: '800' },
  meta: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginTop: 4 },
  section: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.textMuted, textTransform: 'uppercase', marginVertical: 8 },
  item: { ...card, marginBottom: 8, paddingVertical: 10 },
  itemName: { fontWeight: '700', fontSize: 15 },
});
