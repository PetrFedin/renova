/** Расходы по этапам: единый факт vs план из сметы */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { stagePlanFromEstimate } from '@/lib/stageEstimate';
import { stageSpentUnified } from '@/lib/domain/expenseAnalytics';
import type { Stage, ReceiptItem, EstimateLine, OsExpense, MaterialPick, Purchase, Room } from '@/lib/api';
import { pushOsNav } from '@/lib/pushOsNav';
import type { OsRole } from '@/constants/osSections';
import { useRenova } from '@/lib/context/RenovaContext';

export function ExpenseByStage({
  stages,
  lines,
  receipts,
  expenses,
  picks = [],
  purchases = [],
  rooms = [],
  returnTo,
  role: roleProp,
}: {
  stages: Stage[];
  lines: EstimateLine[];
  receipts: ReceiptItem[];
  expenses?: OsExpense[];
  picks?: MaterialPick[];
  purchases?: Purchase[];
  rooms?: Room[];
  returnTo?: string;
  role?: OsRole;
}) {
  const { user } = useRenova();
  const role: OsRole = roleProp ?? (user?.role === 'contractor' ? 'contractor' : 'customer');
  const ex = expenses || [];
  const rows = stages.map((st) => ({
    st,
    spent: stageSpentUnified(receipts, ex, picks, rooms, stages, st.id, purchases),
    plan: stagePlanFromEstimate(st, lines),
  })).filter((x) => x.plan > 0 || x.spent > 0);

  if (!rows.length) {
    return (
      <View style={s.box}>
        <Text style={s.head}>Расходы по этапам</Text>
        <Text style={s.empty}>Нет привязанных расходов — укажите этап при скане чека или вручную.</Text>
      </View>
    );
  }

  const totalPlan = rows.reduce((a, r) => a + r.plan, 0);
  const totalSpent = rows.reduce((a, r) => a + r.spent, 0);

  return (
    <View style={s.box}>
      <Text style={s.head}>Расходы по этапам · {formatRub(totalSpent)}{totalPlan ? ` / ${formatRub(totalPlan)}` : ''}</Text>
      {rows.map(({ st, plan, spent }) => {
        const over = plan > 0 && spent > plan;
        return (
          <Pressable
            key={st.id}
            style={s.row}
            onPress={() =>
              pushOsNav({ pathname: '/stage/[id]', params: { id: st.id } }, returnTo, role)
            }
          >
            <Text style={s.name}>{st.name}</Text>
            <Text style={[s.val, over && s.over]}>{formatRub(spent)}{plan ? ` / ${formatRub(plan)}` : ''}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  box: { backgroundColor: RenovaTheme.colors.surface, borderRadius: 12, padding: 14, marginBottom: 12 },
  head: { fontWeight: '800', marginBottom: 8 },
  empty: { fontSize: 13, color: RenovaTheme.colors.textMuted, lineHeight: 18 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  name: { fontWeight: '600', flex: 1 },
  val: { fontSize: 12, color: RenovaTheme.colors.primary, fontWeight: '700' },
  over: { color: RenovaTheme.colors.warning },
});
