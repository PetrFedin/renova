/** Предупреждение, если факт на сводке ≠ сумма unified-списка */
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { reconcileBudgetFact } from '@/lib/domain/budgetFactReconcile';

type Props = {
  serverFact: number;
  listTotal: number;
  compact?: boolean;
};

export function BudgetFactReconcileBanner({ serverFact, listTotal, compact }: Props) {
  const r = reconcileBudgetFact(serverFact, listTotal);
  if (r.aligned) return null;

  return (
    <View style={[s.box, compact && s.compact]}>
      <Text style={s.title}>Расхождение факта</Text>
      <Text style={s.line}>
        Сводка {formatRub(r.serverFact)} · список {formatRub(r.listTotal)} · разница {formatRub(r.delta)}
      </Text>
      <Text style={s.hint}>
        Обновите экран. Если не сойдётся — проверьте недавние чеки и закупки материалов (только «куплено»).
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    backgroundColor: '#FEF3C7',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#FDE047',
  },
  compact: { marginBottom: 8, padding: 10 },
  title: { fontWeight: '800', fontSize: 13, color: '#92400E', marginBottom: 4 },
  line: { fontSize: 13, color: RenovaTheme.colors.text, fontWeight: '600' },
  hint: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 6, lineHeight: 15 },
});
