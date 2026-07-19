/** Слой «Изменения» — доп. работы и согласование заказчиком */
import { View, Text, StyleSheet, Alert } from 'react-native';
import { router } from 'expo-router';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { ObjectSection } from '@/components/screens/object/ObjectSection';
import { changeOrderStatusLabel } from '@/constants/labels';
import { api, type ChangeOrder } from '@/lib/api';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { budgetTabRoute } from '@/constants/osSections';
import { useRenova } from '@/lib/context/RenovaContext';

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
    const budget = budgetTabRoute(role, 'summary');
    const buttons: { text: string; style?: 'cancel'; onPress?: () => void }[] = [
      { text: 'OK', style: 'cancel' },
      {
        text: 'Открыть бюджет',
        onPress: () => router.push({ pathname: budget.pathname, params: budget.params } as never),
      },
    ];
    if (documentId) {
      buttons.push({
        text: 'Подписать',
        onPress: () =>
          router.push({ pathname: '/documents', params: { returnTo: '/(customer)/(tabs)/object' } } as never),
      });
    }
    Alert.alert(
      'Доп. работы одобрены',
      documentId
        ? `${formatRub(order.amount)} в плане бюджета. Подпишите черновик в Документах.`
        : `${formatRub(order.amount)} добавлено к плану бюджета.`,
      buttons,
    );
  };
  const pending = orders.filter((o) => o.status === 'pending');
  const decided = orders.filter((o) => o.status !== 'pending');

  return (
    <View style={s.wrap}>
      <ObjectSection
        title="Ждут вашего решения"
        hint={pending.length ? 'Одобрите или отклоните — сумма сметы обновится автоматически.' : 'Нет ожидающих доп. работ.'}
      >
        {!pending.length && <Text style={s.meta}>Все изменения обработаны</Text>}
        {pending.map((o) => (
          <ChangeOrderRow
            key={o.id}
            order={o}
            canWrite={canWrite}
            onApprove={async () => {
              try {
                const res = await api.approveChangeOrder(userId, projectId, o.id);
                await onProjectReload();
                onOrdersChanged(await api.listChangeOrders(userId, projectId));
                notifyBudgetDelta(o, res?.document_id);
              } catch (e) {
                if (isOfflineQueued(e)) notifyOfflineQueued('Одобрение доп. работ');
              }
            }}
            onReject={async () => {
              try {
                await api.rejectChangeOrder(userId, projectId, o.id);
                onOrdersChanged(await api.listChangeOrders(userId, projectId));
              } catch (e) {
                if (isOfflineQueued(e)) notifyOfflineQueued('Отклонение доп. работ');
              }
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
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
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
