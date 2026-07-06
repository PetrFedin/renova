/** Сравнение сметы по шаблону с рыночной оценкой — риск и резерв */
import type { MarketEstimate } from '@/constants/regions';

export type MarketEstimateInsights = {
  templateTotal: number;
  marketTotal: number;
  rangeLow: number;
  rangeHigh: number;
  recommendedReserve: number;
  /** Смета заметно ниже рынка — риск недооценки */
  undervaluationRisk: boolean;
  riskPercent: number;
  hint: string;
};

export function buildMarketEstimateInsights(
  templateTotal: number,
  market: MarketEstimate | null,
): MarketEstimateInsights | null {
  if (!market || templateTotal <= 0) return null;

  const marketTotal = market.grand_total;
  const rangeLow = Math.round(marketTotal * 0.92);
  const rangeHigh = Math.round(marketTotal * 1.08);
  const recommendedReserve = market.reserve > 0 ? market.reserve : Math.round(marketTotal * 0.1);
  const gap = marketTotal - templateTotal;
  const riskPercent = Math.round((gap / marketTotal) * 100);
  const undervaluationRisk = gap > marketTotal * 0.12;

  let hint = 'Смета по шаблону близка к рынку — резерв на непредвиденные расходы всё равно полезен.';
  if (undervaluationRisk) {
    hint = 'Шаблонная смета ниже рынка — заложите резерв или уточните комнаты для точности.';
  } else if (gap < -marketTotal * 0.08) {
    hint = 'Шаблон выше типичного рынка — проверьте объём работ или выберите другие типы работ.';
  }

  return {
    templateTotal,
    marketTotal,
    rangeLow,
    rangeHigh,
    recommendedReserve,
    undervaluationRisk,
    riskPercent,
    hint,
  };
}
