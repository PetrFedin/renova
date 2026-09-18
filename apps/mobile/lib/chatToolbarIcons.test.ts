/**
 * Кнопки панели ввода в чате — иконки, а не эмодзи.
 *
 * Панель была набрана эмодзи прямо в тексте: `📷 📎 ✓? 💳`. Это самый частый
 * экран приложения, и там сразу три беды.
 *
 * Эмодзи рисует система: разный вес, разная ширина, цвет — ряд выглядел
 * разнокалиберным рядом со строгими Ionicons на других экранах. Канон
 * приводит ровно этот случай как запрещённый.
 *
 * Ни у одной кнопки не было `accessibilityLabel`: для незрячего человека
 * кнопка называлась «камера со вспышкой» или не читалась вовсе.
 *
 * А в режиме только-чтения все четыре выглядели работающими: `disabled` был,
 * вид не менялся ни на пиксель. Человек жал и не получал ни результата, ни
 * объяснения.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mobile = join(import.meta.dirname, '..');
const src = (path: string) => readFileSync(join(mobile, path), 'utf8');

const thread = src('components/renova/chat/ChatThreadView.tsx');
const list = src('components/renova/chat/ChatListView.tsx');
const button = src('components/renova/chat/ChatToolButton.tsx');

// --- эмодзи больше не элементы управления ------------------------------------

for (const emoji of ['📷', '📎', '💳', '✓?', '📌']) {
  assert.ok(
    !thread.includes(emoji),
    `эмодзи ${emoji} снова используется как иконка в ChatThreadView`,
  );
}
assert.ok(!list.includes('📌'), 'эмодзи 📌 снова используется как иконка в ChatListView');

// ...а реакции остаются эмодзи: там эмодзи — это содержимое, а не иконка.
assert.ok(
  thread.includes("REACTIONS = ['👍'"),
  'реакции перестали быть эмодзи — а они и есть эмодзи по смыслу',
);

// --- у каждой кнопки есть имя -------------------------------------------------

for (const label of [
  'Отправить фото',
  'Прикрепить файл',
  'Запросить подтверждение',
  'Выставить счёт',
]) {
  assert.ok(thread.includes(`label="${label}"`), `кнопка «${label}» без имени для диктора`);
}
assert.equal(
  (thread.match(/<ChatToolButton/g) || []).length,
  4,
  'число кнопок панели изменилось — проверьте имена и иконки',
);

// --- выключенная кнопка выглядит выключенной ----------------------------------

assert.ok(
  button.includes('accessibilityState={{ disabled: Boolean(disabled) }}'),
  'диктор не узнает, что кнопка выключена',
);
assert.ok(
  /color=\{disabled \? RenovaTheme\.colors\.textSubtle/.test(button),
  'выключенная кнопка выглядит как рабочая',
);
assert.ok(
  (thread.match(/disabledHint=\{CHAT_READ_ONLY_HINT\}/g) || []).length === 4,
  'не у всех кнопок есть объяснение, почему они недоступны',
);

// --- зона нажатия ------------------------------------------------------------

assert.ok(button.includes('hitSlop={8}'), 'у кнопки панели нет запаса на промах');
assert.ok(
  button.includes('minWidth: RenovaTheme.minTouch') && button.includes('minHeight: RenovaTheme.minTouch'),
  'кнопка панели меньше минимальной зоны нажатия',
);

console.log('chatToolbarIcons.test OK');
