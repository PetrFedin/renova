/** Список закупок Renova OS */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import type { Purchase } from '@/lib/api';
import { PURCHASE_STATUS_LABEL } from '@/constants/labels';
import { PURCHASE_NEXT_STATUS, purchaseAdvanceLabel, purchaseCancelStatus } from '@/lib/domain/purchaseLifecycle';
import { pushOsNav } from '@/lib/pushOsNav';
import { useRenova } from '@/lib/context/RenovaContext';
import type { OsRole } from '@/constants/osSections';

type Props = {
  purchases: Purchase[];
  readOnly?: boolean;
  returnTo?: string;
  mutationKey?: string | null;
  onAdvance?: (id: string, status: string) => void;
};

export function PurchaseList({ purchases, readOnly, returnTo, mutationKey, onAdvance }: Props) {
  const { user } = useRenova();
  const role: OsRole = user?.role === 'contractor' ? 'contractor' : 'customer';
  const busy = Boolean(mutationKey);
  if (!purchases.length) return null;

  return (
    <View style={s.wrap}>
      <Text style={s.h}>Закупки</Text>
      <Text style={s.pipe}>Черновик → Заказано → Оплачено → Доставлено (факт)</Text>
      {purchases.map((purchase) => {
        const next = PURCHASE_NEXT_STATUS[purchase.status];
        const cancel = purchaseCancelStatus(purchase.status);
        const nextKey = next ? `purchase:${purchase.id}:${next}` : null;
        const cancelKey = cancel ? `purchase:${purchase.id}:${cancel}` : null;
        return (
          <View key={purchase.id} style={s.card}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Открыть закупку ${purchase.supplier_name || 'без поставщика'}`}
              disabled={busy}
              onPress={() => pushOsNav({ pathname: '/purchase/[id]', params: { id: purchase.id } }, returnTo, role)}
            >
              <View style={s.row}>
                <Text style={s.title}>{purchase.supplier_name || 'Без поставщика'}</Text>
                <Text style={s.st}>{PURCHASE_STATUS_LABEL[purchase.status] || purchase.status}</Text>
              </View>
              <Text style={s.sum}>{formatRub(purchase.total_amount)} · {purchase.items.length} поз.</Text>
            </Pressable>
            {purchase.items.slice(0, 3).map((item) => (
              <Text key={item.id} style={s.item} numberOfLines={1}>{item.name} — {item.qty} {item.unit}</Text>
            ))}
            {!readOnly && next && onAdvance ? (
              <PrimaryButton
                title={purchaseAdvanceLabel(next)}
                variant="outline"
                compact
                loading={mutationKey === nextKey}
                disabled={busy && mutationKey !== nextKey}
                onPress={() => onAdvance(purchase.id, next)}
              />
            ) : null}
            {!readOnly && cancel && onAdvance ? (
              <PrimaryButton
                title={purchaseAdvanceLabel(cancel)}
                variant="dangerOutline"
                compact
                loading={mutationKey === cancelKey}
                disabled={busy && mutationKey !== cancelKey}
                onPress={() => onAdvance(purchase.id, cancel)}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 8, marginBottom: 12 },
  h: { ...screenTypography.section, marginTop: 0, fontSize: 15, fontWeight: '700', color: RenovaTheme.colors.text },
  pipe: { ...screenTypography.listMeta, marginBottom: 10 },
  card: { ...listRowStyles.row },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  title: { ...screenTypography.listTitle, flex: 1 },
  st: { ...screenTypography.listMeta, marginTop: 0 },
  sum: { ...screenTypography.listTitle, fontSize: 14, marginTop: 6 },
  item: { ...screenTypography.listMeta },
});
