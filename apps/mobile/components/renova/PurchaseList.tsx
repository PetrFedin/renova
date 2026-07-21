/** Список закупок Renova OS */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme, card, formatRub } from '@/constants/Theme';
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
  onAdvance?: (id: string, status: string) => void;
};

export function PurchaseList({ purchases, readOnly, returnTo, onAdvance }: Props) {
  const { user } = useRenova();
  const role: OsRole = user?.role === 'contractor' ? 'contractor' : 'customer';
  if (!purchases.length) return null;
  return (
    <View style={s.wrap}>
      <Text style={s.h}>Закупки</Text>
      <Text style={s.pipe}>Черновик → Заказано → Оплачено → Доставлено (факт)</Text>
      {purchases.map((p) => {
        const next = PURCHASE_NEXT_STATUS[p.status];
        const cancel = purchaseCancelStatus(p.status);
        return (
          <View key={p.id} style={s.card}>
          <Pressable
            onPress={() =>
              // W118: карточка закупки → SoT
              pushOsNav({ pathname: '/purchase/[id]', params: { id: p.id } }, returnTo, role)
            }
          >
            <View style={s.row}>
              <Text style={s.title}>{p.supplier_name || 'Без поставщика'}</Text>
              <Text style={s.st}>{PURCHASE_STATUS_LABEL[p.status] || p.status}</Text>
            </View>
            <Text style={s.sum}>{formatRub(p.total_amount)} · {p.items.length} поз.</Text>
          </Pressable>
            {p.items.slice(0, 3).map((i) => (
              <Text key={i.id} style={s.item} numberOfLines={1}>{i.name} — {i.qty} {i.unit}</Text>
            ))}
            {!readOnly && next && onAdvance && (
              <PrimaryButton
                title={purchaseAdvanceLabel(next)}
                variant="outline"
                compact
                onPress={() => onAdvance(p.id, next)}
              />
            )}
            {!readOnly && cancel && onAdvance && (
              <PrimaryButton
                title={purchaseAdvanceLabel(cancel)}
                variant="outline"
                compact
                onPress={() => onAdvance(p.id, cancel)}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 8, marginBottom: 12 },
  h: { fontSize: 17, fontWeight: '700', marginBottom: 4, color: RenovaTheme.colors.text },
  pipe: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginBottom: 10 },
  card: { ...card, marginBottom: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  title: { fontSize: 15, fontWeight: '700', flex: 1, color: RenovaTheme.colors.text },
  st: { fontSize: 12, color: RenovaTheme.colors.textMuted },
  sum: { fontSize: 14, fontWeight: '600', marginTop: 6, color: RenovaTheme.colors.text },
  item: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 4 },
});
