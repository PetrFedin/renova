/**
 * План по интервалам не должен превращать план периода в 125%.
 *
 * В месяце из 30-31 дня интервалов по неделям получается пять, а каждому
 * выдавалась ровно четверть плана периода. Экран «Распределение плана»
 * показывал в сумме на четверть больше, чем собственный заголовок того же
 * экрана. Проверка идёт по каждому месяцу года, чтобы високосный февраль
 * и месяцы разной длины считались одинаково честно.
 */
import {
  apportion,
  buildPeriodBuckets,
  periodPlanRange,
  plannedShareForPeriod,
} from './aggregateBudgetByPeriod';

const PLAN = 1_200_000;
const P_START = '2026-01-01';
const P_END = '2026-12-31';

function sumPlanned(now: Date, period: 'week' | 'month' | 'year') {
  const buckets = buildPeriodBuckets([], period, PLAN, P_START, P_END, now);
  return {
    buckets,
    sum: buckets.reduce((s, b) => s + b.planned, 0),
    head: plannedShareForPeriod(PLAN, period, P_START, P_END, now),
  };
}

// 1. Сумма планов интервалов равна плану периода — в каждом месяце года.
for (let m = 0; m < 12; m += 1) {
  const now = new Date(2026, m, 15, 12, 0, 0);
  for (const period of ['week', 'month', 'year'] as const) {
    const { sum, head, buckets } = sumPlanned(now, period);
    if (sum !== head) {
      throw new Error(
        `план по интервалам не сходится: ${2026}-${m + 1} ${period} — ` +
          `${buckets.length} интервал(ов), сумма ${sum}, план периода ${head}`,
      );
    }
  }
}

// 2. План месяца — это план на весь месяц, а не на прошедшую его часть:
//    в один и тот же месяц число не зависит от сегодняшнего дня.
const early = plannedShareForPeriod(PLAN, 'month', P_START, P_END, new Date(2026, 8, 2, 12));
const late = plannedShareForPeriod(PLAN, 'month', P_START, P_END, new Date(2026, 8, 29, 12));
if (early !== late) throw new Error(`план месяца плывёт по дням: ${early} → ${late}`);

// 3. Интервал вне срока проекта не получает плана.
const shortProject = buildPeriodBuckets([], 'year', PLAN, '2026-02-01', '2026-03-31', new Date(2026, 5, 15, 12));
const outside = shortProject.filter((b) => b.key !== '2026-02' && b.key !== '2026-03');
if (outside.some((b) => b.planned !== 0)) {
  throw new Error('месяцы вне срока проекта получили план');
}
const inside = shortProject.filter((b) => b.key === '2026-02' || b.key === '2026-03');
if (inside.reduce((s, b) => s + b.planned, 0) <= 0) throw new Error('месяцы внутри срока остались без плана');

// 4. Окно плана месяца покрывает месяц целиком.
const range = periodPlanRange('month', new Date(2026, 1, 10, 12));
if (range.start.getDate() !== 1 || range.end.getMonth() !== 1 || range.end.getDate() !== 28) {
  throw new Error('окно плана месяца не совпадает с календарным месяцем');
}

// 5. Разложение суммы не теряет и не добавляет копеек.
if (apportion(100, [1, 1, 1]).reduce((s, x) => s + x, 0) !== 100) throw new Error('apportion 100/3');
if (apportion(7, [3, 1]).join(',') !== '5,2') throw new Error(`apportion 7 по [3,1]: ${apportion(7, [3, 1]).join(',')}`);
if (apportion(50, [0, 0]).join(',') !== '0,0') throw new Error('apportion без весов');
if (apportion(0, [1, 2]).join(',') !== '0,0') throw new Error('apportion нулевого плана');

console.log('periodPlanBuckets.test OK');
