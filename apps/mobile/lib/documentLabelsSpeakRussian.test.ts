/**
 * Документ не должен говорить с заказчиком по-латыни.
 *
 * Найдено обходом живого приложения с чтением дерева доступности: карточка
 * канонического документа читалась как
 *
 *   button "Реестр для банка. Документ · active · v1"
 *
 * `active` — это значение серверного перечисления `DocumentStatus`
 * (backend/app/models/project_documents.py). `statusLabel` знал три значения
 * из экспорта (`ready`, `verified`, `unverified`), а остальные возвращал как
 * есть — то есть весь жизненный цикл документа показывался заказчику
 * латиницей: active, superseded, archived, deleted, submitting.
 *
 * Тем же способом нашлись ещё две утечки перечислений:
 *   • OCR-статусы `suggested` / `confirmed` / `unavailable` падали в default и
 *     читались как «OCR suggested» — притом `suggested` это основной исход,
 *     который сервер и выставляет;
 *   • подсказка типа показывала `→ receipt` вместо «→ чек».
 *
 * Значение вне перечисления по-прежнему возвращается как есть: незнакомое
 * состояние лучше показать, чем промолчать.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  documentStatusLabel,
  documentTypeLabel,
  ocrStatusLabel,
} from './documentCenterMeta';

const ROOT = new URL('../', import.meta.url).pathname;
const hub = readFileSync(`${ROOT}components/renova/DocumentsHub.tsx`, 'utf8');

/** Значения DocumentStatus из backend/app/models/project_documents.py. */
const DOCUMENT_STATUSES = ['draft', 'active', 'superseded', 'archived', 'deleted'];
/** Плюс промежуточное состояние из project_document_service.py. */
const EXTRA_STATUSES = ['submitting', 'ready', 'verified', 'unverified'];
/** Значения DocumentType оттуда же. */
const DOCUMENT_TYPES = [
  'acceptance_act', 'design_package', 'receipt', 'estimate',
  'contract', 'invoice', 'warranty', 'upload', 'other',
];
/** Статусы OCR из backend/app/services/document_ocr_service.py. */
const OCR_STATUSES = [
  'queued', 'processing', 'suggested', 'confirmed', 'unavailable', 'failed', 'done',
];

const LATIN = /[a-z]/i;

test('ни одно состояние документа не остаётся латиницей', () => {
  for (const status of [...DOCUMENT_STATUSES, ...EXTRA_STATUSES]) {
    const label = documentStatusLabel(status);
    assert.ok(label, `${status}: подписи нет вовсе`);
    assert.ok(!LATIN.test(label), `${status}: показывается как «${label}»`);
  }
});

test('именно «active» больше не попадает в карточку', () => {
  // Ровно та строка, что читалась в живом приложении.
  assert.equal(documentStatusLabel('active'), 'Действует');
});

test('ни один тип документа не остаётся латиницей', () => {
  for (const type of DOCUMENT_TYPES) {
    const label = documentTypeLabel(type);
    assert.ok(!LATIN.test(label), `${type}: показывается как «${label}»`);
  }
});

test('ни один статус OCR не остаётся латиницей', () => {
  for (const status of OCR_STATUSES) {
    const label = ocrStatusLabel({ status });
    assert.ok(label, `${status}: подписи нет вовсе`);
    // «OCR» — это аббревиатура, а не утечка перечисления.
    const rest = label.replace(/OCR/g, '');
    assert.ok(!LATIN.test(rest), `${status}: показывается как «${label}»`);
  }
});

test('подсказка типа переводится вместе со статусом', () => {
  const label = ocrStatusLabel({ status: 'suggested', suggested_type: 'receipt' });
  assert.ok(label && label.includes('чек'), `подсказка осталась латиницей: «${label}»`);
  assert.ok(label && !label.includes('receipt'));
});

test('«suggested» и «done» — один и тот же исход', () => {
  // Сервер выставляет `suggested`; клиент исторически знал только `done`.
  assert.equal(ocrStatusLabel({ status: 'suggested' }), ocrStatusLabel({ status: 'done' }));
});

test('честность про демо-классификацию сохранена', () => {
  // W67 #29: stub ≠ распознанный документ — формулировку менять нельзя.
  assert.match(String(ocrStatusLabel({ status: 'suggested' })), /демо-классификация/);
});

test('незнакомое значение показывается, а не прячется', () => {
  assert.equal(documentStatusLabel('невиданное'), 'невиданное');
  assert.equal(documentTypeLabel('невиданное'), 'невиданное');
  assert.match(String(ocrStatusLabel({ status: 'невиданное' })), /невиданное/);
});

test('пустое состояние остаётся пустым, а не превращается в слово', () => {
  assert.equal(documentStatusLabel(null), null);
  assert.equal(documentStatusLabel(''), null);
  assert.equal(ocrStatusLabel({ status: 'none' }), null);
  assert.equal(ocrStatusLabel(null), null);
});

test('чек по-прежнему судят по проверке, а не по состоянию', () => {
  // У чека состояние документа не показывают: важно, проверен он или нет.
  assert.match(hub, /doc\.source === 'receipt'\) return doc\.verified \? 'Проверен' : 'Не проверен'/);
});

test('карточка документа берёт подпись из общего словаря', () => {
  assert.match(hub, /documentStatusLabel\(doc\.status\)/);
  assert.ok(
    !/doc\.status \|\| '—'/.test(hub),
    'сырое состояние всё ещё может попасть в подпись',
  );
});
