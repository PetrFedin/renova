/** Статус сверки факта: предупреждение при расхождении или подтверждение при совпадении */
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { reconcileBudgetFact } from '@/lib/domain/budgetFactReconcile';
import { BudgetFactReconcileBanner } from '@/components/renova/budget/BudgetFactReconcileBanner';

type Props = {
  serverFact: number;
  listTotal: number;
  compact?: boolean;
  /** Показывать зелёную строку при совпадении — для investor-grade доверия */
  showAligned?: boolean;
};

export function BudgetFactStatus({ serverFact, listTotal, compact, showAligned }: Props) {
  const r = reconcileBudgetFact(serverFact, listTotal);

  if (!r.aligned) {
    return <BudgetFactReconcileBanner serverFact={serverFact} listTotal={listTotal} compact={compact} />;
  }

  if (!showAligned) return null;

  return (
    <View style={[s.ok, compact && s.compact]}>
      <Text style={s.okText}>Факт сходится: {formatRub(r.serverFact)} · список без дублей</Text>
    </View>
  );
}

const s = StyleSheet.create({
  ok: {
    backgroundColor: '#ECFDF5',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  compact: { marginBottom: 8, padding: 8 },
  okText: { fontSize: 12, color: '#065F46', fontWeight: '600' },
});
