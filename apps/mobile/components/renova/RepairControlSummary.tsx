/** Сводка контроля ремонта: план · факт · чеки · оплаты подрядчикам */
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { BUDGET_FACT_FORMULA_HINT } from '@/lib/domain/budgetFactReconcile';
import type { Payment, ReceiptItem } from '@/lib/api';

export function RepairControlSummary({
  budgetPlanned, budgetSpent, receipts, payments, listTotal,
}: {
  budgetPlanned: number; budgetSpent: number;
  receipts: ReceiptItem[]; payments: Payment[];
  /** Сумма единого списка «Расходы» без дублей */
  listTotal?: number;
}) {
  const receiptSum = receipts.reduce((a, r) => a + r.amount, 0);
  const paid = payments.filter((p) => p.status === 'confirmed').reduce((a, p) => a + p.amount, 0);
  const pending = payments.filter((p) => p.status === 'pending').reduce((a, p) => a + p.amount, 0);
  const manual = receipts.filter((r) => r.source === 'manual').length;
  const fact = budgetSpent;
  const list = listTotal ?? fact;
  return (
    <View style={s.box}>
      <Text style={s.head}>Контроль бюджета</Text>
      <View style={s.row}><Text style={s.label}>План (смета)</Text><Text style={s.val}>{formatRub(budgetPlanned)}</Text></View>
      <View style={s.row}><Text style={s.label}>Факт (учтённые траты)</Text><Text style={s.val}>{formatRub(fact)}</Text></View>
      <View style={s.row}><Text style={s.label}>Список расходов</Text><Text style={s.val}>{formatRub(list)}{list !== fact ? ' ≈ факт' : ''}</Text></View>
      <View style={s.row}><Text style={s.label}>Сумма чеков</Text><Text style={s.val}>{formatRub(receiptSum)}{manual ? ` (${manual} вручную)` : ''}</Text></View>
      <View style={s.row}><Text style={s.label}>Оплачено подрядчикам</Text><Text style={s.val}>{formatRub(paid)}</Text></View>
      {pending > 0 && <View style={s.row}><Text style={s.label}>Счета к оплате</Text><Text style={[s.val, { color: RenovaTheme.colors.warning }]}>{formatRub(pending)}</Text></View>}
      <Text style={s.note}>Счета к оплате — долг подрядчикам, не путать с фактом ремонта. Закупки материалов в факте — только «Куплено».</Text>
      <Text style={s.formula}>{BUDGET_FACT_FORMULA_HINT}</Text>
      {budgetPlanned > 0 && fact > budgetPlanned * 0.9 && (
        <Text style={s.warn}>⚠ Факт приближается к лимиту сметы</Text>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  box: { backgroundColor: RenovaTheme.colors.surface, borderRadius: 12, padding: 14, marginBottom: 12 },
  head: { fontWeight: '800', marginBottom: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  label: { fontSize: 13, color: RenovaTheme.colors.textMuted },
  val: { fontWeight: '700', fontSize: 13 },
  note: { marginTop: 8, fontSize: 11, color: RenovaTheme.colors.textMuted, lineHeight: 15 },
  formula: { marginTop: 6, fontSize: 10, color: RenovaTheme.colors.textMuted, lineHeight: 14 },
  warn: { marginTop: 8, fontSize: 12, color: RenovaTheme.colors.warning, fontWeight: '600' },
});
