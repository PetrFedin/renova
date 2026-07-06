/** Деталь закупки — статусы и позиции */
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { useRenova } from '@/lib/context/RenovaContext';
import { useWriteAllowed } from '@/components/renova/ReadOnlyGuard';
import { api, Purchase } from '@/lib/api';
import { RenovaTheme, card, formatRub } from '@/constants/Theme';
import { calendarTabRoute, repairTabRoute } from '@/constants/osSections';
import { pushOsNav, replaceOsNav } from '@/lib/pushOsNav';

const ST: Record<string, string> = {
  draft: 'Черновик', approved: 'Согласовано', ordered: 'Заказано', paid: 'Оплачено',
  partial: 'Частично', delivered: 'Доставлено', cancelled: 'Отменено', returned: 'Возврат',
};
const NEXT: Record<string, string | null> = {
  draft: 'ordered', ordered: 'paid', paid: 'delivered', approved: 'ordered',
};

export default function PurchaseDetailScreen() {
  const { id, returnTo } = useLocalSearchParams<{ id: string; returnTo?: string }>();
  const { user, activeProject } = useRenova();
  const canWrite = useWriteAllowed();
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const role = user?.role === 'contractor' ? 'contractor' : 'customer';

  const reload = useCallback(() => {
    if (!user || !activeProject || !id) return;
    api.listPurchases(user.id, activeProject.id).then((items) => {
      setPurchase(items.find((p) => p.id === id) || null);
    }).catch(() => setPurchase(null));
  }, [user?.id, activeProject?.id, id]);

  useEffect(() => { reload(); }, [reload]);

  if (!purchase) return <View style={s.center}><Text>Загрузка…</Text></View>;

  const next = NEXT[purchase.status];

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
            title={next === 'ordered' ? 'Отметить заказ' : next === 'paid' ? 'Оплачено' : 'Доставлено'}
            onPress={async () => { await api.updatePurchaseStatus(user.id, activeProject.id, purchase.id, next); reload(); }}
          />
        )}
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
