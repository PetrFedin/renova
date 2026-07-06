/** Объединённый список чеков и osExpenses — одна лента на вкладке «Расходы» */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import type { ExpenseDetailRow } from '@/lib/domain/expenseAnalytics';

const KIND_LABEL: Record<string, string> = {
  receipt: 'Чек',
  expense: 'Запись',
  material: 'Закупка',
};

export function UnifiedExpenseList({
  rows,
  onPress,
}: {
  rows: ExpenseDetailRow[];
  onPress: (row: ExpenseDetailRow) => void;
}) {
  if (!rows.length) return null;
  const sum = rows.reduce((acc, row) => acc + row.amount, 0);

  return (
    <View style={s.wrap}>
      <Text style={s.section}>Все траты · {rows.length} · {formatRub(sum)}</Text>
      <Text style={s.meta}>План из сметы · факт — чеки, записи и закупки материалов ниже</Text>
      {rows.map((row) => (
        <Pressable key={row.id} style={s.row} onPress={() => onPress(row)}>
          <View style={{ flex: 1 }}>
            <Text style={s.amount}>{formatRub(row.amount)}</Text>
            <Text style={s.title} numberOfLines={1}>{row.title}</Text>
            <Text style={s.metaLine} numberOfLines={2}>
              {KIND_LABEL[row.kind] || row.kind}
              {' · '}{row.categoryLabel}
              {row.roomName ? ` · ${row.roomName}` : ''}
              {row.stageName ? ` · ${row.stageName}` : ''}
              {row.date ? ` · ${row.date.slice(0, 10)}` : ''}
            </Text>
          </View>
          {row.kind === 'receipt' ? (
            <Text style={[s.badge, row.verified ? s.ok : s.pending]}>{row.verified ? '✓ ФНС' : 'Чек'}</Text>
          ) : row.kind === 'material' ? (
            <Text style={[s.badge, s.material]}>Мат.</Text>
          ) : (
            <Text style={[s.badge, s.pending]}>Запись</Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 8 },
  section: { fontWeight: '700', fontSize: 16, marginBottom: 4 },
  meta: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 8, lineHeight: 16 },
  row: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#fff', padding: 12, borderRadius: 8, marginBottom: 6 },
  amount: { fontWeight: '700', fontSize: 15 },
  title: { fontSize: 13, marginTop: 2, color: RenovaTheme.colors.text },
  metaLine: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  badge: { fontSize: 11, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  ok: { backgroundColor: '#DCFCE7', color: RenovaTheme.colors.success },
  pending: { backgroundColor: '#FEF3C7', color: RenovaTheme.colors.warning },
  material: { backgroundColor: '#E0E7FF', color: '#4338CA' },
});
