/**
 * Только что зарегистрированная организация не должна оказаться взаперти.
 *
 * Пройдено как клиент на живом приложении: регистрация исполнителя по SMS →
 * экран «Выберите объект» → «Нет проектов» и две кнопки, «Найти заявки» и
 * «Обновить проекты». Любой другой адрес возвращал сюда же:
 * `OsPendingProjectPickEffect` держит флаг `pendingProjectPick`, пока объект не
 * выбран, а выбирать нечего.
 *
 * Замыкание: карточку компании — по которой заказчики и находят исполнителя в
 * подборе — заполнить негде, бригаду собрать негде, выйти некуда.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../../', import.meta.url).pathname;
const empty = readFileSync(`${ROOT}components/renova/ProjectEmptyState.tsx`, 'utf8');
const effect = readFileSync(`${ROOT}components/renova/os/OsPendingProjectPickEffect.tsx`, 'utf8');
/** Перенос строки в JSX не меняет текста для пользователя. */
const emptyText = empty.replace(/\s+/g, ' ');

test('из пустого экрана есть выход в профиль', () => {
  assert.match(emptyText, /title="Профиль и бригада"/);
  assert.match(empty, /replaceOsNav\(tabsRoute\('contractor', 'profile'\), undefined, 'contractor'\)/);
});

test('сказано, зачем туда идти', () => {
  // Кнопка без причины — ещё одна развилка вслепую.
  assert.match(emptyText, /по ней заказчики находят исполнителя/);
});

test('выход показан только исполнителю без объектов', () => {
  // У заказчика пустой экран решается созданием объекта, а не профилем.
  assert.match(empty, /!projects\.length && role === 'contractor' && bucket === 'active' \?/);
});

test('прежние действия на месте', () => {
  assert.match(emptyText, /title="Найти заявки"/);
  assert.match(emptyText, /title="Обновить проекты"/);
  assert.match(empty, /pushOsNav\('\/job-leads', pathname, 'contractor'\)/);
});

test('возврат на выбор объекта не запирает профиль', () => {
  assert.match(effect, /if \(pathname\.endsWith\('\/profile'\)\) return;/);
});

test('прежние условия возврата не ослаблены', () => {
  // Экран выбора по-прежнему подставляется везде, кроме онбординга и профиля.
  assert.match(effect, /if \(!user \|\| activeProject \|\| !pendingPick\)/);
  assert.match(effect, /if \(pathname\.includes\('\/onboarding\/'\)\) return;/);
  assert.match(effect, /replaceOsNav\(projectPickRoute\(\)\)/);
});
