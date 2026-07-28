/** Расходы по категориям — unified list (чеки + os + закупки) */
import { View, Text, StyleSheet } from 'react-native';
import { formatRub, RenovaTheme } from '@/constants/Theme';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';
import { groupExpenseRows, type ExpenseDetailRow } from '@/lib/domain/expenseAnalytics';

export function ExpenseByCategory({ rows }: { rows: ExpenseDetailRow[] }) {
  if (!rows.length) return null;
  const groups = groupExpenseRows(rows, 'category');
  const total = rows.reduce((a, r) => a + r.amount, 0);
  return (
    <View style={s.box}>
      <Text style={s.head}>Расходы по категориям · {formatRub(total)}</Text>
      {groups.map((g) => (
        <View key={g.key} style={s.row}>
          <Text style={s.label}>{g.label}</Text>
          <Text style={s.val}>{formatRub(g.total)}</Text>
          <View style={s.bar}>
            <View style={[s.fill, { width: `${Math.min(100, (g.total / total) * 100)}%` }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  box: { marginBottom: 12 },
  head: { ...screenTypography.section, marginTop: 0, marginBottom: 10 },
  row: { ...listRowStyles.row, borderBottomWidth: 0, marginBottom: 4 },
  label: { ...screenTypography.listTitle, fontSize: 13 },
  val: { ...screenTypography.listMeta, color: RenovaTheme.colors.primary, fontWeight: '600' },
  bar: { height: 4, backgroundColor: RenovaTheme.colors.border, borderRadius: 2, marginTop: 4, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: RenovaTheme.colors.primary },
});
