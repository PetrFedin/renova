/** Детализация бюджета по периоду — после нажатия на виджет */
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { RenovaTheme, formatRub, card } from '@/constants/Theme';
import { BudgetPeriodPicker } from '@/components/renova/BudgetPeriodPicker';
import {
  BUDGET_FOCUS_LABEL,
  type BudgetFocus,
  type BudgetPeriod,
} from '@/constants/budgetPeriod';
import {
  buildPeriodBuckets,
  filterRowsByPeriod,
  plannedShareForPeriod,
  sumRows,
} from '@/lib/domain/aggregateBudgetByPeriod';
import type { ExpenseDetailRow } from '@/lib/domain/expenseAnalytics';
import { pushOsNav } from '@/lib/pushOsNav';
import { budgetTabRoute, type OsRole } from '@/constants/osSections';

type Props = {
  role: OsRole;
  period: BudgetPeriod;
  focus: BudgetFocus;
  planned: number;
  spentTotal: number;
  forecastTotal?: number;
  customerLimit?: number | null;
  rows: ExpenseDetailRow[];
  projectStart?: string | null;
  projectEnd?: string | null;
  returnTo: string;
  onExpensePress?: (row: ExpenseDetailRow) => void;
};

export function BudgetPeriodDetailSection(props: Props) {
  const {
    role,
    period,
    focus,
    planned,
    spentTotal,
    forecastTotal,
    customerLimit,
    rows,
    projectStart,
    projectEnd,
    returnTo,
    onExpensePress,
  } = props;

  const periodPlanned = plannedShareForPeriod(planned, period, projectStart, projectEnd);
  const periodSpent = sumRows(filterRowsByPeriod(rows, period));
  const limit = customerLimit && customerLimit > 0 ? customerLimit : planned;
  const limitShare = customerLimit
    ? plannedShareForPeriod(customerLimit, period, projectStart, projectEnd)
    : periodPlanned;
  const remaining = Math.max(0, limitShare - periodSpent);
  const overrun = periodSpent > limitShare ? periodSpent - limitShare : 0;

  const headline =
    focus === 'plan'
      ? formatRub(periodPlanned)
      : focus === 'fact'
        ? formatRub(periodSpent)
        : focus === 'forecast'
          ? formatRub(forecastTotal ?? spentTotal)
          : formatRub(remaining);

  const buckets = buildPeriodBuckets(rows, period, planned, projectStart, projectEnd);

  return (
    <View style={s.wrap}>
      <Text style={s.title}>
        {BUDGET_FOCUS_LABEL[focus]} · детализация
      </Text>
      <BudgetPeriodPicker period={period} focus={focus} tab="summary" />
      <View style={s.hero}>
        <Text style={s.heroVal}>{headline}</Text>
        <Text style={s.heroSub}>
          {focus === 'left' && overrun > 0
            ? `Перерасход ${formatRub(overrun)} от лимита`
            : focus === 'plan'
              ? `Доля плана сметы за период`
              : focus === 'fact'
                ? `Траты за период · всего ${formatRub(spentTotal)}`
                : focus === 'forecast'
                  ? 'Прогноз на конец проекта'
                  : `Лимит периода ${formatRub(limitShare)}`}
        </Text>
        {customerLimit ? (
          <Text style={s.limit}>Ваш лимит: {formatRub(customerLimit)} · смета {formatRub(planned)}</Text>
        ) : null}
      </View>

      {focus === 'fact' || focus === 'left' ? (
        <>
          <Text style={s.section}>По интервалам</Text>
          {buckets.map((b) => (
            <View key={b.key} style={s.bucket}>
              <View style={s.bucketHead}>
                <Text style={s.bucketLabel}>{b.label}</Text>
                <Text style={[s.bucketVal, b.spent > b.planned && b.planned > 0 && s.over]}>
                  {formatRub(b.spent)}
                </Text>
              </View>
              {b.planned > 0 ? (
                <Text style={s.bucketMeta}>план ~{formatRub(b.planned)} · {b.rows.length} операций</Text>
              ) : (
                <Text style={s.bucketMeta}>{b.rows.length} операций</Text>
              )}
              {b.rows.slice(0, 3).map((r) => (
                <Pressable key={r.id} onPress={() => onExpensePress?.(r)}>
                  <Text style={s.rowLine}>
                    {formatRub(r.amount)} · {r.title}
                  </Text>
                </Pressable>
              ))}
            </View>
          ))}
          <Pressable
            style={s.link}
            onPress={() => pushOsNav(budgetTabRoute(role, 'expenses', { period }), returnTo)}
          >
            <Text style={s.linkT}>Все расходы за период →</Text>
          </Pressable>
        </>
      ) : null}

      {focus === 'plan' ? (
        <>
          <Text style={s.section}>Распределение плана</Text>
          {buckets.map((b) => (
            <View key={b.key} style={s.bucket}>
              <Text style={s.bucketLabel}>{b.label}</Text>
              <Text style={s.bucketVal}>~{formatRub(b.planned)}</Text>
            </View>
          ))}
        </>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { ...card, marginBottom: 16, borderLeftWidth: 3, borderLeftColor: RenovaTheme.colors.primary },
  title: { fontSize: 14, fontWeight: '800', marginBottom: 8 },
  hero: { marginBottom: 12, paddingVertical: 8 },
  heroVal: { fontSize: 22, fontWeight: '700', color: RenovaTheme.colors.primary },
  heroSub: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 4, lineHeight: 17 },
  limit: { fontSize: 12, color: RenovaTheme.colors.text, marginTop: 6, fontWeight: '600' },
  section: {
    fontSize: 11,
    fontWeight: '700',
    color: RenovaTheme.colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 4,
  },
  bucket: {
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: RenovaTheme.colors.border,
  },
  bucketHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bucketLabel: { fontSize: 13, fontWeight: '600', flex: 1 },
  bucketVal: { fontSize: 15, fontWeight: '800' },
  over: { color: RenovaTheme.colors.danger },
  bucketMeta: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  rowLine: { fontSize: 12, color: RenovaTheme.colors.primary, marginTop: 4 },
  link: { marginTop: 10, alignItems: 'center' },
  linkT: { fontSize: 13, fontWeight: '700', color: RenovaTheme.colors.primary },
});
