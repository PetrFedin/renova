/**
 * Отказ одной сводки не должен прятать счета.
 *
 * Найдено обходом живого приложения. `/os/budget` отвечает 500, и вкладка
 * «Оплаты» показывала «Не удалось загрузить бюджет» — хотя `/payments`
 * вернулся `200`, и счета были загружены.
 *
 * Причина: запасной путь загрузки собирал семь запросов через `Promise.all`,
 * а тот отклоняется целиком при первом же отказе. Шесть успешных ответов
 * выбрасывались вместе с одним неудачным.
 *
 * При этом обнулять сводку тоже нельзя: «0 ₽ расходов» читается как «расходов
 * нет», и в экране это уже было сказано словами — принцип сохранён.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../../', import.meta.url).pathname;
const hook = readFileSync(`${ROOT}lib/hooks/useOsBudgetScreen.ts`, 'utf8');
const screen = readFileSync(`${ROOT}components/screens/OsBudgetScreen.tsx`, 'utf8');
/** Перенос строки в JSX не меняет текста для пользователя. */
const screenText = screen.replace(/\s+/g, ' ');

test('частичная загрузка не выбрасывает то, что пришло', () => {
  assert.match(
    hook,
    /Promise\.allSettled\(\[/,
    'Promise.all отклоняется целиком: один отказ уносит все успешные ответы',
  );
  assert.ok(
    !/await Promise\.all\(\[\s*\n\s*api\.osBudget/.test(hook),
    'запасной путь всё ещё собирает запросы через Promise.all',
  );
});

test('каждая часть применяется только когда пришла', () => {
  for (const setter of ['setPayments', 'setExpenses', 'setReceipts', 'setPicks']) {
    const pattern = new RegExp(`status === 'fulfilled'\\) ${setter}\\(`);
    assert.match(hook, pattern, `${setter} вызывается без проверки, что ответ пришёл`);
  }
});

test('неудачная сводка не превращается в ноль', () => {
  // Обнуление читалось бы как «расходов нет» — ровно та ложь, против которой
  // в экране уже написан текст.
  assert.ok(
    !/setSummary\(null\)/.test(hook),
    'сводка обнуляется при отказе — это покажет 0 ₽ вместо отсутствия данных',
  );
  assert.match(hook, /setSummaryFailed\(sm\.status === 'rejected'\)/);
});

test('полный отказ остаётся полным отказом', () => {
  // Если не пришло ничего — это настоящая неудача экрана, а не частичная.
  assert.match(hook, /every\(\(part\) => part\.status === 'rejected'\)/);
  assert.match(hook, /throw settled\[0\]\.reason/);
});

test('вкладка сводки объясняет отказ и не блокирует соседние', () => {
  assert.match(screenText, /Сводка не загрузилась/);
  assert.match(screenText, /Счета и расходы на соседних вкладках открыты/);
  // Общий экран ошибки остаётся — но только для случая «не пришло ничего».
  assert.match(screenText, /Не удалось загрузить бюджет/);
});

test('сводка рисуется только когда она есть', () => {
  assert.match(screen, /resolvedTab === 'summary' && summaryFailed/);
  assert.match(screen, /resolvedTab === 'summary' && !summaryFailed/);
});
