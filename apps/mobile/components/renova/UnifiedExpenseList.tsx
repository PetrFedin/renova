/** Объединённый список чеков и osExpenses — одна лента на вкладке «Расходы» */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';
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
  section: { ...screenTypography.section, marginTop: 0, fontWeight: '700', color: RenovaTheme.colors.text, fontSize: 14 },
  meta: { ...screenTypography.listMeta, marginBottom: 8 },
  row: { ...listRowStyles.row, flexDirection: 'row', alignItems: 'flex-start' },
  amount: { ...screenTypography.listTitle },
  title: { ...screenTypography.listMeta, color: RenovaTheme.colors.text },
  metaLine: { ...screenTypography.listMeta },
  badge: { fontSize: 11, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  ok: { backgroundColor: '#DCFCE7', color: RenovaTheme.colors.success },
  pending: { backgroundColor: '#FEF3C7', color: RenovaTheme.colors.warning },
  material: { backgroundColor: '#E0E7FF', color: '#4338CA' },
});
