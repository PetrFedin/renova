/** Выбор периода drill-down бюджета */
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import { BUDGET_PERIOD_LABEL, type BudgetPeriod } from '@/constants/budgetPeriod';

const PERIODS: BudgetPeriod[] = ['week', 'month', 'year', 'all'];

export function BudgetPeriodPicker({
  period,
  focus,
  tab = 'summary',
}: {
  period: BudgetPeriod;
  focus?: string | null;
  tab?: string;
}) {
  const setPeriod = (p: BudgetPeriod) => {
    const params: Record<string, string> = { tab, period: p };
    if (focus) params.focus = focus;
    router.setParams(params);
  };

  return (
    <View style={s.wrap}>
      <Text style={s.label}>Период</Text>
      <View style={s.row}>
        {PERIODS.map((p) => {
          const on = period === p;
          return (
            <Pressable key={p} style={[s.chip, on && s.on]} onPress={() => setPeriod(p)}>
              <Text style={[s.t, on && s.tOn]}>{BUDGET_PERIOD_LABEL[p]}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 12 },
  label: {
    fontSize: 10,
    fontWeight: '700',
    color: RenovaTheme.colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surface,
  },
  on: { borderColor: RenovaTheme.colors.primary, backgroundColor: RenovaTheme.colors.infoBg },
  t: { fontSize: 13, fontWeight: '600', color: RenovaTheme.colors.text },
  tOn: { color: RenovaTheme.colors.primary },
});
