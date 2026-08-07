/** Слой «Изменения» — доп. работы и согласование заказчиком */
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { ObjectSection } from '@/components/screens/object/ObjectSection';
import { changeOrderStatusLabel } from '@/constants/labels';
import { api, type ChangeOrder } from '@/lib/api';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { budgetTabRoute } from '@/constants/osSections';
import { useRenova } from '@/lib/context/RenovaContext';
import { pushOsNav } from '@/lib/pushOsNav';
import { alertChangeOrderApproved } from '@/lib/procurementNav';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { reportError } from '@/lib/reportError';

type Props = {
  userId: string;
  projectId: string;
  orders: ChangeOrder[];
  canWrite: boolean;
  onOrdersChanged: (orders: ChangeOrder[]) => void;
  onProjectReload: () => Promise<void>;
};

export function EstimateChangesLayer({
  userId,
  projectId,
  orders,
  canWrite,
  onOrdersChanged,
  onProjectReload,
}: Props) {
  const { user } = useRenova();
  const role = user?.role === 'contractor' ? 'contractor' : 'customer';

  const notifyBudgetDelta = (order: ChangeOrder, documentId?: string) => {
    alertChangeOrderApproved(role, formatRub(order.amount), documentId);
  };

  const reconcileCommittedOrder = async (source: 'Approve' | 'Reject') => {
    try {
      // The parent owns the fresh ProjectDetail reload. Do not follow it with
      // fabricated/stale project side effects in this child layer.
      await onProjectReload();
    } catch (error) {
      reportError(`components.screens.estimate.EstimateChangesLayer.${source}.ProjectRefresh`, error, { projectId });
    }
    try {
      onOrdersChanged(await api.listChangeOrders(userId, projectId));
    } catch (error) {
      reportError(`components.screens.estimate.EstimateChangesLayer.${source}.OrdersRefresh`, error, { projectId });
    }
  };

  const pending = orders.filter((o) => o.status === 'pending');
  const decided = orders.filter((o) => o.status !== 'pending');
  /** Clarity D: сумма дельты по ожидающим — сразу видно влияние на бюджет */
  const pendingDelta = pending.reduce((sum, o) => sum + (Number(o.amount) || 0), 0);

  return (
    <View style={s.wrap}>
      <ObjectSection
        title={pending.length ? `Ждут решения · Δ ${formatRub(pendingDelta)}` : 'Ждут вашего решения'}
        hint={
          pending.length
            ? `Одобрите или отклоните ${pending.length} поз. — смета обновится. Итоговая дельта: ${formatRub(pendingDelta)}.`
            : 'Нет ожидающих доп. работ.'
        }
      >
        {!pending.length && <Text style={s.meta}>Все изменения обработаны</Text>}
        {pending.length > 0 ? (
          <View style={s.deltaBar}>
            <Text style={s.deltaLabel}>Сумма ожидающих изменений</Text>
            <Text style={s.deltaValue}>{formatRub(pendingDelta)}</Text>
            <PrimaryButton
              title="К бюджету"
              variant="outline"
              compact
              onPress={() => pushOsNav(budgetTabRoute(role, 'summary'), undefined, role)}
            />
          </View>
        ) : null}
        {pending.map((o) => (
          <ChangeOrderRow
            key={o.id}
            order={o}
            canWrite={canWrite}
            onApprove={() => {
              // Clarity R: money confirm перед одобрением дельты
              showActionConfirm({
                title: 'Согласовать доп. работу?',
                message: `«${o.title}» · ${formatRub(o.amount)} попадёт в смету и бюджет.`,
                primaryLabel: 'Согласовать',
                onPrimary: () => {
                  void (async () => {
                    let result: Awaited<ReturnType<typeof api.approveChangeOrder>>;
                    try {
                      result = await api.approveChangeOrder(userId, projectId, o.id);
                    } catch (error) {
                      if (isOfflineQueued(error)) {
                        notifyOfflineQueued('Одобрение доп. работ');
                      } else {
                        reportError('components.screens.estimate.EstimateChangesLayer.Approve.Mutation', error, { projectId, orderId: o.id });
                        showActionConfirm({
                          title: 'Не удалось согласовать',
                          message: error instanceof Error ? error.message : 'Повторите попытку.',
                        });
                      }
                      return;
                    }

                    // Server decision is committed. Notification and refresh are
                    // follow-up work and must not turn it into a false rejection.
                    try {
                      notifyBudgetDelta(o, result?.document_id);
                    } catch (error) {
                      reportError('components.screens.estimate.EstimateChangesLayer.Approve.Notification', error, { projectId, orderId: o.id });
                    }
                    await reconcileCommittedOrder('Approve');
                  })();
                },
                secondaryLabel: 'Отмена',
                onSecondary: () => undefined,
              });
            }}
            onReject={() => {
              showActionConfirm({
                title: 'Отклонить доп. работу?',
                message: `«${o.title}» · ${formatRub(o.amount)} не войдёт в смету.`,
                primaryLabel: 'Отклонить',
                onPrimary: () => {
                  void (async () => {
                    try {
                      await api.rejectChangeOrder(userId, projectId, o.id);
                    } catch (error) {
                      if (isOfflineQueued(error)) {
                        notifyOfflineQueued('Отклонение доп. работ');
                      } else {
                        reportError('components.screens.estimate.EstimateChangesLayer.Reject.Mutation', error, { projectId, orderId: o.id });
                        showActionConfirm({
                          title: 'Не удалось отклонить',
                          message: error instanceof Error ? error.message : 'Повторите попытку.',
                        });
                      }
                      return;
                    }
                    await reconcileCommittedOrder('Reject');
                  })();
                },
                secondaryLabel: 'Отмена',
                onSecondary: () => undefined,
              });
            }}
          />
        ))}
      </ObjectSection>

      {decided.length > 0 && (
        <ObjectSection title="История изменений" hint="Решения по доп. работам">
          {decided.map((o) => (
            <View key={o.id} style={s.orderRow}>
              <Text style={s.orderTitle}>
                {o.title} · {formatRub(o.amount)}
              </Text>
              <Text style={s.meta}>Статус: {changeOrderStatusLabel(o.status)}</Text>
              {o.status === 'approved' ? (
                <PrimaryButton
                  title="В бюджет"
                  variant="outline"
                  compact
                  onPress={() => pushOsNav(budgetTabRoute(role, 'summary'), undefined, role)}
                />
              ) : null}
            </View>
          ))}
        </ObjectSection>
      )}
    </View>
  );
}

function ChangeOrderRow({
  order,
  canWrite,
  onApprove,
  onReject,
}: {
  order: ChangeOrder;
  canWrite: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <View style={s.orderRow}>
      <Text style={s.orderTitle}>
        {order.title} · {formatRub(order.amount)}
      </Text>
      <Text style={s.meta}>Статус: {changeOrderStatusLabel(order.status)}</Text>
      {canWrite && (
        <View style={s.actions}>
          <PrimaryButton title="Согласовать" onPress={onApprove} />
          <View style={{ height: 8 }} />
          <PrimaryButton title="Отклонить" variant="outline" onPress={onReject} />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 12, gap: 4 },
  deltaBar: {
    marginBottom: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surface,
    gap: 6,
  },
  deltaLabel: { fontSize: 12, color: RenovaTheme.colors.textMuted },
  deltaValue: { fontSize: 18, fontWeight: '700', color: RenovaTheme.colors.text },
  orderRow: {
    backgroundColor: RenovaTheme.colors.surface,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    marginBottom: 8,
  },
  orderTitle: { fontWeight: '600', fontSize: 14 },
  meta: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  actions: { marginTop: 10 },
});