/** Статьи расходов по выбранным проектам */
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { RenovaTheme, formatRub, card } from '@/constants/Theme';
import type { PortfolioCategoryRow } from '@/lib/domain/aggregatePortfolioBudget';

type Props = {
  rows: PortfolioCategoryRow[];
  loading: boolean;
  projectCount: number;
  unavailableProjectCount?: number;
};

function valueText(label: 'план' | 'факт', value: number | null): string {
  return value == null ? `${label} — нет детализации` : `${label} ${formatRub(value)}`;
}

export function PortfolioCategoryBreakdown({
  rows,
  loading,
  projectCount,
  unavailableProjectCount = 0,
}: Props) {
  if (loading) {
    return (
      <View style={[s.wrap, s.center]}>
        <ActivityIndicator color={RenovaTheme.colors.accent} />
        <Text style={s.loading}>Считаем статьи расходов…</Text>
      </View>
    );
  }

  if (!projectCount) {
    return null;
  }

  if (unavailableProjectCount === projectCount) {
    return (
      <View style={s.wrap}>
        <Text style={s.head}>Статьи расходов</Text>
        <Text style={s.warning}>
          Детализация временно недоступна для выбранных объектов. Итоги не подменяются нулевыми значениями — повторите позже.
        </Text>
      </View>
    );
  }

  if (!rows.length) {
    return (
      <View style={s.wrap}>
        <Text style={s.head}>Статьи расходов</Text>
        <Text style={s.empty}>Нет подтверждённой детализации по выбранным объектам.</Text>
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      <Text style={s.head}>Статьи расходов</Text>
      <Text style={s.sub}>
        План — из сметы. Факт — только из подтверждённого реестра расходов. Если сопоставимого факта нет, RENOVA показывает «нет детализации», а не нулевое отклонение.
      </Text>
      {unavailableProjectCount > 0 ? (
        <Text style={s.warning}>
          Частичные данные: план и реестр расходов недоступны для {unavailableProjectCount} из {projectCount} объект(ов). Сумма ниже не является итогом всего выбранного портфеля.
        </Text>
      ) : null}

      {rows.map((row) => (
        <View key={row.key} style={[s.line, row.key === 'total' && s.lineTotal]}>
          <View style={s.lineTop}>
            <Text style={[s.label, row.key === 'total' && s.labelTotal]}>{row.label}</Text>
            {row.hasOverrun && row.variancePct != null && row.key !== 'total' ? (
              <Text style={s.badge}>+{row.variancePct}%</Text>
            ) : null}
          </View>
          <View style={s.lineBottom}>
            <Text style={s.values}>
              {valueText('план', row.planned)} · {valueText('факт', row.spent)}
            </Text>
            {row.variance != null && row.variance !== 0 ? (
              <Text style={[s.delta, row.variance > 0 ? s.deltaBad : s.deltaGood]}>
                {row.variance > 0 ? '+' : ''}{formatRub(row.variance)}
              </Text>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { ...card, marginBottom: 0, padding: 12 },
  center: { alignItems: 'center', paddingVertical: 20, gap: 8 },
  loading: { fontSize: 12, color: RenovaTheme.colors.textMuted },
  head: { fontSize: 13, fontWeight: '800', color: RenovaTheme.colors.text, marginBottom: 4 },
  sub: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 10, lineHeight: 16 },
  empty: { fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 16 },
  warning: { fontSize: 12, color: RenovaTheme.colors.dangerText, lineHeight: 17, marginBottom: 10 },
  line: {
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: RenovaTheme.colors.borderLight,
  },
  lineTotal: {
    marginTop: 4,
    borderTopWidth: 2,
    borderTopColor: RenovaTheme.colors.border,
  },
  lineTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  lineBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 },
  label: { fontSize: 13, fontWeight: '600', color: RenovaTheme.colors.text, flex: 1 },
  labelTotal: { fontWeight: '800' },
  badge: {
    fontSize: 10,
    fontWeight: '800',
    color: RenovaTheme.colors.dangerText,
    backgroundColor: RenovaTheme.colors.dangerBg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  values: { fontSize: 12, color: RenovaTheme.colors.textMuted, flex: 1 },
  delta: { fontSize: 12, fontWeight: '700' },
  deltaBad: { color: RenovaTheme.colors.dangerText },
  deltaGood: { color: RenovaTheme.colors.successText },
});
