/**
 * Факт по статье портфеля должен быть измеренной величиной.
 *
 * Раньше для работ, вывоза и резерва в поле «факт» подставлялся тот же план:
 * отклонение выходило нулевым всегда, перерасход по этим статьям не мог быть
 * обнаружен ни при каких данных, а на экране «факт 500 000 ₽» читался как
 * подтверждённая трата, хотя ничего не измерялось.
 *
 * Проверка идёт и по источнику: сервер обязан отдавать факт по работам и
 * вывозу, иначе клиент снова останется без измеренных величин.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { aggregatePortfolioBudgetBreakdowns } from './aggregatePortfolioBudget';
import type { BudgetBreakdown } from '@/lib/api';

const base: BudgetBreakdown = {
  works: 500_000,
  materials_plan: 300_000,
  materials_fact: 0,
  waste: 40_000,
  reserve: 60_000,
  total_planned: 900_000,
  budget_planned: 900_000,
  budget_spent: 410_000,
};

// 1. Без записей факт не выдумывается и не подменяется планом.
const bare = aggregatePortfolioBudgetBreakdowns([base]);
for (const key of ['works', 'materials', 'waste', 'reserve']) {
  const row = bare.find((r) => r.key === key);
  if (!row) throw new Error(`нет строки ${key}`);
  if (row.spent !== null) throw new Error(`${key}: факт взялся из ниоткуда — ${row.spent}`);
  if (row.variance !== null || row.hasOverrun) throw new Error(`${key}: отклонение при отсутствующем факте`);
  if (!row.factNote) throw new Error(`${key}: не объяснено, почему факта нет`);
}
const totalBare = bare.find((r) => r.key === 'total');
if (!totalBare || totalBare.spent !== 410_000) throw new Error('итог должен браться из бюджета объекта');

// 2. Факт по работам — это фактические объёмы, а не план.
const measured = aggregatePortfolioBudgetBreakdowns([
  { ...base, works_fact: 620_000, works_fact_records: 7, waste_fact: 25_000, waste_fact_records: 2, materials_fact: 280_000, materials_fact_records: 5 },
]);
const works = measured.find((r) => r.key === 'works');
if (!works || works.spent !== 620_000) throw new Error('факт по работам не взят из ответа сервера');
if (works.planned === works.spent) throw new Error('факт снова совпал с планом');
if (!works.hasOverrun || works.variance !== 120_000) throw new Error('перерасход по работам не обнаружен');
const waste = measured.find((r) => r.key === 'waste');
if (!waste || waste.spent !== 25_000 || waste.variance !== -15_000) throw new Error('вывоз: факт по выполненным заказам');
const reserve = measured.find((r) => r.key === 'reserve');
if (!reserve || reserve.spent !== null) throw new Error('у резерва факта не бывает');

// 3. Старый сервер без счётчиков: факт по материалам у него уже был и теряться не должен.
const legacy = aggregatePortfolioBudgetBreakdowns([{ ...base, materials_fact: 280_000 }]);
const legacyMaterials = legacy.find((r) => r.key === 'materials');
if (!legacyMaterials || legacyMaterials.spent !== 280_000) throw new Error('факт по материалам со старого сервера потерян');

// 4. Суммирование по нескольким объектам.
const two = aggregatePortfolioBudgetBreakdowns([
  { ...base, works_fact: 100_000, works_fact_records: 1 },
  { ...base, works_fact: 50_000, works_fact_records: 2 },
]);
const worksTwo = two.find((r) => r.key === 'works');
if (!worksTwo || worksTwo.spent !== 150_000 || worksTwo.factRecords !== 3) throw new Error('факт по портфелю не сложился');

// 5. Сервер действительно считает эти факты — иначе клиент остаётся ни с чем.
const analytics = readFileSync(join(__dirname, '../../../../backend/app/api/v1/analytics.py'), 'utf8');
for (const marker of ['"works_fact"', '"works_fact_records"', '"waste_fact"', '"waste_fact_records"', '"materials_fact_records"']) {
  if (!analytics.includes(marker)) throw new Error(`сервер не отдаёт ${marker} в budget-breakdown`);
}
if (!analytics.includes('l.quantity_actual * l.unit_price')) {
  throw new Error('факт по работам на сервере не считается по фактическим объёмам');
}
if (!analytics.includes('w.status.value == "done"')) {
  throw new Error('факт по вывозу на сервере не ограничен выполненными заказами');
}

console.log('portfolioCategoryFacts.test OK');
