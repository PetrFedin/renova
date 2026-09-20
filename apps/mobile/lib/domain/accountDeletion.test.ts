/**
 * Удаление аккаунта должно быть доступно изнутри приложения.
 *
 * `DELETE /api/v1/auth/me` на сервере есть: обезличивает профиль, помечает
 * удалённым, закрывает все сессии и возвращает срок хранения. В приложении к
 * нему не было ни кнопки, ни метода в клиенте — при том, что рядом уже жили
 * выгрузка своих данных и закрытие сессий.
 *
 * Без такой кнопки приложение с учётными записями не проходит ревью App Store
 * (правило 5.1.1(v)).
 *
 * Проверено на живом приложении: блок открывается, кнопка удаления остаётся
 * заблокированной (`aria-disabled=true`, прозрачность 0.45), пока не введено
 * слово подтверждения. Само удаление живьём не выполнялось — оно обезличило бы
 * демо-аккаунт в базе разработки.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  DELETE_CONFIRM_WORD,
  DELETE_CONSEQUENCES,
  deleteConfirmMatches,
  retentionNotice,
} from './accountDeletion';

const ROOT = new URL('../../', import.meta.url).pathname;
const block = readFileSync(`${ROOT}components/screens/profile/AccountDeleteBlock.tsx`, 'utf8');
const auth = readFileSync(`${ROOT}lib/api/auth.ts`, 'utf8');
const customer = readFileSync(`${ROOT}components/screens/profile/CustomerProfileScreen.tsx`, 'utf8');
const contractor = readFileSync(`${ROOT}components/screens/profile/ContractorProfileScreen.tsx`, 'utf8');
/** Перенос строки в JSX не меняет текста для пользователя. */
const blockText = block.replace(/\s+/g, ' ');

test('клиент умеет вызвать удаление', () => {
  assert.match(auth, /deleteMe: \(userId: string\)/);
  assert.match(auth, /'\/api\/v1\/auth\/me',\s*\{ method: 'DELETE' \}/);
});

test('кнопка есть у обеих ролей', () => {
  for (const [name, source] of [['заказчик', customer], ['исполнитель', contractor]] as const) {
    assert.match(source, /<AccountDeleteBlock/, `у роли «${name}» нет удаления аккаунта`);
    assert.match(source, /onDeleted=\{async \(\) => \{\s*await logout\(\);/);
  }
});

test('подтверждение требует ввода слова', () => {
  assert.ok(deleteConfirmMatches(DELETE_CONFIRM_WORD));
  assert.ok(deleteConfirmMatches(' удалить '), 'регистр и пробелы не должны мешать');
  assert.ok(!deleteConfirmMatches(''), 'пустой ввод не подтверждение');
  assert.ok(!deleteConfirmMatches('удали'), 'частичное слово не подтверждение');
  assert.match(block, /disabled=\{busy \|\| !deleteConfirmMatches\(confirmText\)\}/);
});

test('последствия перечислены до нажатия, а не после', () => {
  assert.ok(DELETE_CONSEQUENCES.length >= 3);
  assert.match(blockText, /Что произойдёт/);
  for (const line of DELETE_CONSEQUENCES) {
    assert.ok(line.endsWith('.'), `незаконченная строка последствия: ${line}`);
  }
});

test('чужие документы не обещаны к удалению', () => {
  // Сметы и переписка — документы второй стороны договора; обещать их стереть
  // значило бы обещать невыполнимое.
  assert.ok(
    DELETE_CONSEQUENCES.some((line) => /остаются у второй стороны/.test(line)),
    'не сказано, что остаётся у второй стороны',
  );
});

test('срок хранения показывается человеку, а не прячется', () => {
  const notice = retentionNotice('2026-10-21T00:00:00Z');
  assert.match(notice, /21\.10\.2026/);
  assert.match(notice, /Окончательное удаление/);
});

test('без срока от сервера текст остаётся правдивым', () => {
  for (const value of [null, undefined, 'не-дата']) {
    const notice = retentionNotice(value);
    assert.match(notice, /после срока хранения/);
    assert.ok(!/Invalid/.test(notice), `в текст утекла ошибка разбора даты: ${notice}`);
  }
});

test('неудача удаления объясняется', () => {
  assert.match(blockText, /Аккаунт не удалён/);
  assert.match(block, /reportError\('account\.delete'/);
});

test('блок закрыт по умолчанию', () => {
  // Кнопка удаления не должна стоять раскрытой в списке настроек.
  assert.match(block, /const \[open, setOpen\] = useState\(false\)/);
});
