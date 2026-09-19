/**
 * Зоны нажатия соседних кнопок не накладываются.
 *
 * `hitSlop` расширяет зону нажатия за границы кнопки. Если зазор между
 * соседями меньше суммы их запасов, зоны перекрываются — и в полосе
 * перекрытия выигрывает тот, кто отрисован позже, потому что React Native
 * обходит детей в обратном порядке.
 *
 * Считанная геометрия иконок на карточке объекта:
 *
 *     кнопки 32×32, hitSlop 8 с каждой стороны → зона 48
 *     gap 6 → шаг между центрами 38
 *     перекрытие 48 − 38 = 10 px
 *
 * «Удалить» отрисована второй, значит в этих 10 px выигрывала она. Мало того,
 * её левый запас (8) больше зазора (6), то есть заходил на 2 px внутрь
 * видимой иконки «В архив». Промах по архивации удалял объект.
 *
 * То же на всех трёх наборах: архив/удалить, вернуть/удалить,
 * восстановить/стереть — безопасное действие всегда стоит рядом с
 * разрушительным.
 *
 * Зазоры в шапке замерены на запущенном приложении (375×812): четыре кнопки
 * по 40 px с зазорами ровно 4 — перекрытие 12 px на каждом стыке. Свободного
 * места между логотипом и кнопками 101 px, увеличение зазора требует 36.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mobile = join(import.meta.dirname, '..');
const src = (path: string) => readFileSync(join(mobile, path), 'utf8');

/** Зазор обязан покрывать запасы обоих соседей. */
function assertNoOverlap(gap: number, hitSlop: number, where: string) {
  assert.ok(
    gap >= hitSlop * 2,
    `${where}: зазор ${gap} меньше суммы hitSlop ${hitSlop * 2} — зоны нажатия перекрываются на ${hitSlop * 2 - gap} px`,
  );
}

// --- карточка объекта: архив рядом с удалением --------------------------------

const lifecycle = src('components/renova/ProjectCardLifecycleIcons.tsx');

const slopMatch = lifecycle.match(/const HIT_SLOP = (\d+);/);
assert.ok(slopMatch, 'запас hitSlop иконок карточки больше не задан одним числом');
const lifecycleSlop = Number(slopMatch![1]);

const gapMatch = lifecycle.match(/gap: HIT_SLOP \* 2 \+ (\d+),/);
assert.ok(
  gapMatch,
  'зазор иконок карточки больше не выводится из hitSlop — он может разойтись с ним молча',
);
assertNoOverlap(lifecycleSlop * 2 + Number(gapMatch![1]), lifecycleSlop, 'иконки карточки объекта');

assert.ok(
  lifecycle.includes('hitSlop={HIT_SLOP}'),
  'иконки карточки снова задают запас числом мимо константы',
);

// Разрушительное действие по-прежнему стоит рядом с безопасным — значит
// правило про зазор обязано соблюдаться, а не быть снятым вместе с кнопкой.
assert.ok(
  lifecycle.includes('trash-outline') && lifecycle.includes('archive-outline'),
  'набор действий изменился — перепроверьте соседство безопасного и разрушительного',
);

// --- шапка вкладок ------------------------------------------------------------

const header = src('components/renova/os/OsTabsLayoutOptions.tsx');
const headerGap = header.match(/flexDirection: 'row', alignItems: 'center', gap: (\d+)/);
assert.ok(headerGap, 'ряд иконок шапки изменился');
assertNoOverlap(Number(headerGap![1]), 8, 'иконки шапки');

// --- строка недели ------------------------------------------------------------

const week = src('components/renova/os/WeekScheduleStrip.tsx');
const weekGap = week.match(/summaryRow: \{[^}]*gap: (\d+)/s);
assert.ok(weekGap, 'строка недели изменилась');
assertNoOverlap(Number(weekGap![1]), 8, 'ссылка недели и стрелка календаря');

console.log('hitAreasDoNotOverlap.test OK');
