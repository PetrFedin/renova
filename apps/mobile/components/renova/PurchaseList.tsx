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
  h: { ...screenTypography.section, marginTop: 0, fontSize: 15, fontWeight: '700', color: RenovaTheme.colors.text },
  pipe: { ...screenTypography.listMeta, marginBottom: 10 },
  card: { ...listRowStyles.row },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  title: { ...screenTypography.listTitle, flex: 1 },
  st: { ...screenTypography.listMeta, marginTop: 0 },
  sum: { ...screenTypography.listTitle, fontSize: 14, marginTop: 6 },
  item: { ...screenTypography.listMeta },
});
