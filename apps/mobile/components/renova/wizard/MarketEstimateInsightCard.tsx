/** Рыночная оценка vs шаблон — диапазон, риск, резерв */
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import type { MarketEstimateInsights } from '@/lib/wizard/buildMarketEstimateInsights';

export function MarketEstimateInsightCard({ insights }: { insights: MarketEstimateInsights }) {
  return (
    <View style={[s.box, insights.undervaluationRisk && s.boxWarn]}>
      <Text style={s.head}>Рыночная оценка</Text>
      <Text style={s.range}>
        {formatRub(insights.rangeLow)} — {formatRub(insights.rangeHigh)}
      </Text>
      <Text style={s.row}>
        Смета по шаблону: <Text style={s.strong}>{formatRub(insights.templateTotal)}</Text>
      </Text>
      <Text style={s.row}>
        Рекомендуемый резерв: <Text style={s.strong}>{formatRub(insights.recommendedReserve)}</Text>
      </Text>
      {insights.undervaluationRisk ? (
        <Text style={s.risk}>
          Риск недооценки ~{insights.riskPercent}% — шаблон ниже типичного рынка
        </Text>
      ) : null}
      <Text style={s.hint}>{insights.hint}</Text>
      <Text style={s.note}>
        Уточните комнаты в разделе «Объект» — точность сметы вырастет.
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    marginVertical: 12,
    padding: 14,
    borderRadius: RenovaTheme.radius.md,
    backgroundColor: RenovaTheme.colors.infoBg,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.infoBorder,
    gap: 6,
  },
  boxWarn: {
    backgroundColor: RenovaTheme.colors.warningBg,
    borderColor: RenovaTheme.colors.warningBorder,
  },
  head: { fontSize: 14, fontWeight: '700', color: RenovaTheme.colors.text },
  range: { fontSize: 22, fontWeight: '800', color: RenovaTheme.colors.primary },
  row: { fontSize: 13, color: RenovaTheme.colors.textMuted },
  strong: { fontWeight: '700', color: RenovaTheme.colors.text },
  risk: { fontSize: 13, fontWeight: '600', color: RenovaTheme.colors.warningText },
  hint: { fontSize: 13, lineHeight: 18, color: RenovaTheme.colors.text },
  note: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 4 },
});
