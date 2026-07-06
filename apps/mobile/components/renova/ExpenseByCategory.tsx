/** Расходы по категориям — unified list (чеки + os + закупки) */
import { View, Text, StyleSheet } from 'react-native';
import { formatRub, RenovaTheme } from '@/constants/Theme';
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
  box: { backgroundColor: RenovaTheme.colors.surface, padding: 12, borderRadius: 10, marginBottom: 12 },
  head: { fontWeight: '800', marginBottom: 10 },
  row: { marginBottom: 8 },
  label: { fontSize: 13, fontWeight: '600' },
  val: { fontSize: 12, color: RenovaTheme.colors.primary, marginTop: 2 },
  bar: { height: 4, backgroundColor: RenovaTheme.colors.border, borderRadius: 2, marginTop: 4, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: RenovaTheme.colors.primary },
});
