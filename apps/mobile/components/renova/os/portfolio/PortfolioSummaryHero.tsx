/** Итог по выбранным проектам — план, факт, перерасход/экономия */
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme, formatRub, card } from '@/constants/Theme';
import type { PortfolioSummary } from '@/lib/domain/summarizePortfolio';
import { pluralizeRu } from '@/lib/i18n';

type Props = {
  summary: PortfolioSummary;
  selectedCount: number;
  totalCount: number;
};

export function PortfolioSummaryHero({ summary, selectedCount, totalCount }: Props) {
  const hasSelection = selectedCount > 0;
  const over = summary.overspend > 0;
  const under = summary.savings > 0 && summary.overspend === 0;

  return (
    <View style={s.wrap}>
      <Text style={s.kicker}>
        {hasSelection
          ? `Итого по ${selectedCount} из ${totalCount} ${objectsLabel(totalCount)}`
          : 'Выберите объекты для расчёта'}
      </Text>

      {hasSelection ? (
        <>
          <View style={s.mainRow}>
            <View style={s.mainCell}>
              <Text style={s.mainLabel}>Запланировали</Text>
              <Text style={s.mainValue}>{formatRub(summary.totalPlan)}</Text>
            </View>
            <View style={s.mainCell}>
              <Text style={s.mainLabel}>Потратили</Text>
              <Text style={s.mainValue}>{formatRub(summary.totalSpent)}</Text>
            </View>
          </View>

          <View style={[s.delta, over ? s.deltaBad : under ? s.deltaGood : s.deltaNeutral]}>
            <Text style={[s.deltaTitle, over ? s.deltaTitleBad : under ? s.deltaTitleGood : s.deltaTitleNeutral]}>
              {over
                ? `Перерасход ${formatRub(summary.overspend)} (${summary.variancePct > 0 ? '+' : ''}${summary.variancePct}%)`
                : under
                  ? `Экономия ${formatRub(summary.savings)} (${summary.variancePct}%)`
                  : `В рамках плана · ${summary.spendPct}% бюджета`}
            </Text>
            <Text style={s.deltaSub}>
              {summary.projectsOver > 0 ? `${summary.projectsOver} с перерасходом` : 'Без перерасхода по объектам'}
              {summary.projectsUnder > 0 ? ` · ${summary.projectsUnder} дешевле плана` : ''}
              {summary.completedCount > 0 ? ` · ${summary.completedCount} завершено` : ''}
              {summary.inProgressCount > 0 ? ` · ${summary.inProgressCount} в работе` : ''}
            </Text>
          </View>
        </>
      ) : (
        <Text style={s.hint}>Отметьте галочками объекты ниже — увидите сумму и перерасход только по ним.</Text>
      )}
    </View>
  );
}

function objectsLabel(n: number) {
  // Родительный после «из N …»
  return pluralizeRu(n, ['объекта', 'объектов', 'объектов'] as const);
}

const s = StyleSheet.create({
  wrap: { ...card, marginBottom: 0, padding: 14 },
  kicker: {
    fontSize: 11,
    fontWeight: '700',
    color: RenovaTheme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 10,
  },
  mainRow: { flexDirection: 'row', gap: 10 },
  mainCell: { flex: 1, minWidth: 0 },
  mainLabel: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 4 },
  mainValue: { fontSize: 20, fontWeight: '800', color: RenovaTheme.colors.text },
  delta: {
    marginTop: 12,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
  },
  deltaGood: { backgroundColor: RenovaTheme.colors.successBg, borderColor: RenovaTheme.colors.successBorder },
  deltaBad: { backgroundColor: RenovaTheme.colors.dangerBg, borderColor: RenovaTheme.colors.dangerBorder },
  deltaNeutral: { backgroundColor: RenovaTheme.colors.neutralBg, borderColor: RenovaTheme.colors.neutralBorder },
  deltaTitle: { fontSize: 14, fontWeight: '700' },
  deltaTitleGood: { color: RenovaTheme.colors.successText },
  deltaTitleBad: { color: RenovaTheme.colors.dangerText },
  deltaTitleNeutral: { color: RenovaTheme.colors.text },
  deltaSub: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 4, lineHeight: 16 },
  hint: { fontSize: 13, color: RenovaTheme.colors.textMuted, lineHeight: 18 },
});
