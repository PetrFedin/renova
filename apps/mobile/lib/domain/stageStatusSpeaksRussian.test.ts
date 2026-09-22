/**
 * Этап не показывает заказчику своё перечисление.
 *
 * Найдено на живом экране «Деньги» → панель «Площадки · циклы»:
 *
 *   Подготовка      done
 *   Демонтаж        planned
 *   Черновые работы planned
 *
 * Панель писала `{st.display_status || st.status}`, а это **оба** сырых
 * перечисления. Человеческой подписи в типе `Stage` нет вовсе:
 * `display_status_label` сервер отдаёт в снимках комнаты и работы, но не в
 * `ProjectDetail`, откуда панель и берёт этапы.
 *
 * Тем же разбором нашлось, что у статуса этапа в клиенте **три** словаря:
 * `STAGE_STATUS_LABEL`, `WORK_CARD_STATUS_LABEL` и третий — прямо в
 * `globalSearch`. Третий дословно повторял первый, и разойтись они могли в
 * любой момент. Второй оставлен намеренно: у карточек работ другой регистр
 * («Завершено», «Не начато»), и это осознанная разница, а не дубль.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  STAGE_DISPLAY_STATUS_LABEL,
  STAGE_STATUS_LABEL,
  stageDisplayLabel,
  stageStatusLabel,
} from '../../constants/labels';

const ROOT = new URL('../../', import.meta.url).pathname;
const panel = readFileSync(`${ROOT}components/renova/ProjectSitesPanel.tsx`, 'utf8');
const search = readFileSync(`${ROOT}lib/globalSearch.ts`, 'utf8');

/** Коды из `DISPLAY_LABELS` в backend/app/services/stage_status_service.py. */
const SERVER_DISPLAY_CODES = [
  'not_started', 'preparation', 'in_progress', 'paused',
  'waiting_materials', 'waiting_acceptance', 'completed', 'archive',
];
/** Значения StageStatus. */
const STAGE_STATUSES = ['planned', 'active', 'review', 'done'];

const LATIN = /[a-z]/i;

test('каждый вычисляемый статус сервера имеет русскую подпись', () => {
  for (const code of SERVER_DISPLAY_CODES) {
    const label = STAGE_DISPLAY_STATUS_LABEL[code];
    assert.ok(label, `${code}: подписи нет — код уйдёт на экран как есть`);
    assert.ok(!LATIN.test(label), `${code}: показывается как «${label}»`);
  }
});

test('каждый записанный статус этапа имеет русскую подпись', () => {
  for (const status of STAGE_STATUSES) {
    const label = stageStatusLabel(status);
    assert.ok(!LATIN.test(label), `${status}: показывается как «${label}»`);
  }
});

test('именно «done» и «planned» больше не попадают на экран', () => {
  // Ровно то, что было видно на снимке.
  assert.equal(stageDisplayLabel({ status: 'done' }), 'Сдан');
  assert.equal(stageDisplayLabel({ status: 'planned' }), 'Запланирован');
});

test('вычисляемый статус главнее записанного', () => {
  // `display_status` учитывает блокировки и ожидание материалов — он точнее.
  assert.equal(
    stageDisplayLabel({ display_status: 'waiting_materials', status: 'active' }),
    'Ожидает материалы',
  );
});

test('без вычисленного статуса подпись берётся из записанного', () => {
  assert.equal(stageDisplayLabel({ display_status: null, status: 'review' }), 'На приёмке');
  assert.equal(stageDisplayLabel({ status: 'active' }), 'В работе');
});

test('незнакомый код показывается, а не прячется', () => {
  // Пустая строка была бы хуже: непонятный статус лучше увидеть.
  assert.equal(stageDisplayLabel({ display_status: 'невиданное' }), 'невиданное');
});

test('этап без статуса вовсе не печатает undefined', () => {
  assert.equal(stageDisplayLabel({}), '');
});

test('иконка остаётся в словаре, но не в подписи', () => {
  // `STAGE_STATUS_LABEL` с иконками используют компактные таймлайны.
  assert.match(STAGE_STATUS_LABEL.done, /^✓/);
  assert.ok(!stageStatusLabel('done').includes('✓'));
});

test('срезание иконки не оставляет от неё половину', () => {
  // `🔨` — суррогатная пара. Класс символов без флага `u` срезал только
  // первую половину, и в подписи оставался битый символ: «\udd28 В работе».
  for (const status of STAGE_STATUSES) {
    const label = stageStatusLabel(status);
    for (const ch of label) {
      const code = ch.codePointAt(0)!;
      assert.ok(
        code < 0xd800 || code > 0xdfff,
        `${status}: в подписи «${label}» осталась половина суррогатной пары`,
      );
    }
  }
});

test('панель «Площадки · циклы» не печатает сырые поля', () => {
  assert.match(panel, /\{stageDisplayLabel\(st\)\}/);
  assert.ok(
    !/\{st\.display_status \|\| st\.status\}/.test(panel),
    'на экран снова уходит перечисление',
  );
});

test('поиск больше не держит свой словарь статусов', () => {
  assert.ok(
    !/const STAGE_STATUS: Record<string, string>/.test(search),
    'третий словарь вернулся — он разойдётся с основным',
  );
  assert.match(search, /stageStatusLabel\(st\.status\)/);
});

test('объединение словарей не изменило ни одной подписи в поиске', () => {
  // Прежние значения globalSearch — дословно.
  const before: Record<string, string> = {
    done: 'Сдан', review: 'На приёмке', active: 'В работе', planned: 'Запланирован',
  };
  for (const [status, label] of Object.entries(before)) {
    assert.equal(stageStatusLabel(status), label, `${status}: подпись в поиске изменилась`);
  }
});
