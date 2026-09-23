/**
 * Карточка исполнителя не выдумывает оценку.
 *
 * `ContractorProfile.rating` на сервере — колонка `Float, default=5.0`,
 * которую никто никогда не пишет: системы отзывов в схеме нет. Клиент
 * рисовал её как `★5` для каждого исполнителя, и заказчик при выборе читал
 * это как оценку других заказчиков.
 *
 * Сервер теперь отдаёт `rating: null`, пока оценку никто не измерял. Здесь
 * проверяется, что клиент на `null` говорит правду, а не прячет строку и не
 * подставляет ноль.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { contractorMeta } from './contractorMeta';

const ROOT = new URL('../../', import.meta.url).pathname;
const source = readFileSync(`${ROOT}components/renova/ContractorDirectory.tsx`, 'utf8');

const base = { id: 'c1', name: 'Иван', company: 'Ремонт-Сервис' };

test('без оценок карточка говорит, что их нет', () => {
  const meta = contractorMeta({ ...base, rating: null });
  assert.match(meta, /Оценок пока нет/);
  assert.ok(!meta.includes('★'), `звезда без оценки: «${meta}»`);
});

test('строка не исчезает — молчание читалось бы как «всё в порядке»', () => {
  assert.ok(contractorMeta({ ...base, rating: null }).length > 0);
});

test('настоящая оценка показывается звездой, как и раньше', () => {
  // Появится система отзывов — показ обязан заработать без новой правки.
  assert.match(contractorMeta({ ...base, rating: 4.6 }), /★4\.6/);
});

test('ноль сданных объектов не выдаётся за достижение', () => {
  const meta = contractorMeta({ ...base, rating: null, jobs_done: 0 });
  assert.ok(!meta.includes('объектов'), `«0 объектов» показано: «${meta}»`);
});

test('известное число сданных объектов показывается', () => {
  assert.match(contractorMeta({ ...base, rating: null, jobs_done: 12 }), /12 объектов/);
});

test('неизвестное число сданных объектов не превращается в ноль', () => {
  const meta = contractorMeta({ ...base, rating: null, jobs_done: null });
  assert.ok(!meta.includes('объектов'));
});

test('специализация по-прежнему показывается первой из списка', () => {
  assert.match(
    contractorMeta({ ...base, rating: null, specialties: 'tiling, painting' }),
    /tiling/,
  );
});

test('основание подбора показано рядом с карточкой', () => {
  // Балл заказчику ни о чём не говорит; причина — говорит.
  assert.match(source, /c\.match_basis \? <Text style=\{s\.basis\}>\{c\.match_basis\}<\/Text> : null/);
});

test('подпись основания взята из токенов, а не из числа', () => {
  assert.match(source, /fontSize: RenovaTheme\.fontSize\.caption/);
  assert.match(source, /color: RenovaTheme\.colors\.textMuted/);
});
