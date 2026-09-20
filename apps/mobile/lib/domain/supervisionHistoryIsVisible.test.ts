/**
 * Обещанная история назначений должна быть видна.
 *
 * Карточка технадзора дважды обещает заказчику, что прежнее назначение никуда
 * не денется: «Предыдущее назначение останется в истории» при замене и
 * «История назначения сохранится» при отзыве. Сервер эту историю отдаёт
 * (`GET /api/v1/projects/{id}/technical-supervision/history`, только владельцу-
 * заказчику), клиентский метод `getTechnicalSupervisionHistory` написан — и не
 * вызывался ниоткуда. Обещание было, показать было негде.
 *
 * Найдено сверкой маршрутов API с вызовами из приложения.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../../', import.meta.url).pathname;
const cardPath = `${ROOT}components/renova/TechnicalSupervisionCard.tsx`;
const card = readFileSync(cardPath, 'utf8');
const screen = readFileSync(`${ROOT}components/screens/OsProjectProfileScreen.tsx`, 'utf8');
const client = readFileSync(`${ROOT}lib/api/technicalSupervision.ts`, 'utf8');
/** Перенос строки в JSX не меняет текста для пользователя. */
const cardText = card.replace(/\s+/g, ' ');

test('история запрашивается с того же экрана, где её обещают', () => {
  assert.match(client, /getTechnicalSupervisionHistory:/, 'метод исчез из клиента');
  assert.match(
    card,
    /api\.getTechnicalSupervisionHistory\(userId, projectId\)/,
    'метод написан, но не вызывается — история снова недоступна',
  );
});

test('обещания на месте — проверка не потеряла смысл', () => {
  assert.match(cardText, /Предыдущее назначение останется в истории/);
  assert.match(cardText, /История назначения сохранится/);
});

test('у истории есть подписанный вход', () => {
  assert.match(cardText, /История назначений/);
  assert.match(cardText, /accessibilityRole="button"/);
});

test('после замены и отзыва история перечитывается', () => {
  // Иначе заказчик увидит список, каким он был до его же действия.
  assert.match(card, /\[historyOpen, loadHistory, status\?\.active\?\.id\]/);
});

test('история не грузится, пока её не открыли', () => {
  // Лишний запрос на каждом входе в профиль объекта — это трафик и лимит RPM.
  assert.match(card, /if \(historyOpen\) void loadHistory\(\);/);
});

test('отзыв и действующее назначение различимы', () => {
  assert.match(cardText, /row\.revoked_at \? 'Отозван' : 'Действует'/);
  assert.match(card, /Назначен \$\{formatScheduleDayFull\(row\.appointed_at\)\}/);
});

test('неудача объясняется и даёт повтор', () => {
  assert.match(cardText, /Не удалось загрузить историю назначений/);
  assert.match(card, /reportError\('technicalSupervision\.history'/);
  assert.match(card, /onPress=\{\(\) => void loadHistory\(\)\}/);
});

test('пустая история не выглядит поломкой', () => {
  assert.match(cardText, /Технадзор на этом объекте ещё не назначался/);
});

test('чтение не отключается режимом «только чтение»', () => {
  // Сервер отдаёт историю владельцу-заказчику; readOnly ограничивает правки,
  // а не чтение.
  assert.match(
    screen,
    /canViewTechnicalSupervisionHistory =\s*role === 'customer' && project\.access_mode === 'owner';/,
  );
  assert.match(screen, /canViewHistory=\{canViewTechnicalSupervisionHistory\}/);
});

test('прежние вызовы карточки не изменились', () => {
  // Значение по умолчанию обязано повторять прежнее поведение.
  assert.match(card, /canViewHistory = canManage,/);
});
