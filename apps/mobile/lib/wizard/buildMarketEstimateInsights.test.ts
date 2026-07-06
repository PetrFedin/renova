import { buildMarketEstimateInsights } from './buildMarketEstimateInsights';
import { fallbackMarketEstimate } from '../../constants/regions';

const market = fallbackMarketEstimate({
  region_code: 'moscow',
  work_types: ['painting'],
  floor_sq_m: 45,
  wall_sq_m: 100,
  perimeter_m: 20,
});

const lowTemplate = 10_000;
const insights = buildMarketEstimateInsights(lowTemplate, market);
if (!insights?.undervaluationRisk) throw new Error(`should flag undervaluation, market=${market.grand_total}`);
if (insights.recommendedReserve <= 0) throw new Error('reserve');

const highTemplate = market.grand_total * 1.5;
const ok = buildMarketEstimateInsights(highTemplate, market);
if (ok?.undervaluationRisk) throw new Error('high template should not undervalue');

console.log('buildMarketEstimateInsights.test OK');
