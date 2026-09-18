/**
 * Инструменты разметки плана.
 *
 * Логика вынесена из холста, чтобы её можно было проверить: какой инструмент
 * сколько точек набирает, когда штрих закончен, как считается длина и что
 * писать рядом с линейкой.
 *
 * Отдельно проверяется то, на чём эта задача ломается чаще всего: линейка без
 * пересчёта в пиксели врёт на любом непрямоугольном листе, потому что процент
 * по ширине и процент по высоте — разные величины.
 */
import assert from 'node:assert/strict';
import {
  TOOL_LABEL,
  TOOL_OPACITY,
  TOOL_POINTS,
  TOOL_STROKE,
  annotationAtPoint,
  appendPoint,
  clampToSheet,
  isComplete,
  measureLabel,
  segmentLengthPct,
  toScreenPoint,
  toSheetPoint,
  visibleAnnotations,
  type PlanAnnotation,
  type PlanTool,
} from './planAnnotationTools';

const SHEET = { width: 400, height: 300 }; // 4:3 — непрямоугольный лист
const TOOLS = Object.keys(TOOL_LABEL) as PlanTool[];

// --- палитра полная и согласованная -------------------------------------------

assert.equal(TOOLS.length, 9, 'изменился состав инструментов — проверьте бэкенд');
for (const tool of TOOLS) {
  assert.ok(TOOL_POINTS[tool], `${tool}: не сказано, сколько точек набирает`);
  assert.ok(TOOL_STROKE[tool] > 0, `${tool}: нулевая толщина`);
  assert.ok(TOOL_LABEL[tool], `${tool}: нет подписи в палитре`);
}
// Маркер — выделение: он шире и полупрозрачен, иначе закроет чертёж.
assert.ok(TOOL_STROKE.marker > TOOL_STROKE.freehand, 'маркер не шире карандаша');
assert.ok(TOOL_OPACITY.marker < 1, 'маркер непрозрачен — под ним не читается план');
assert.equal(TOOL_OPACITY.freehand, 1, 'карандаш стал полупрозрачным');

// --- точка не уезжает за лист --------------------------------------------------
// Вернуть её оттуда нечем: маршрута на удаление одной точки нет.

assert.deepEqual(clampToSheet({ x: -40, y: 150 }), { x: 0, y: 100 });
assert.deepEqual(clampToSheet({ x: 50, y: 50 }), { x: 50, y: 50 });

const outside = toSheetPoint({ x: -80, y: 900 }, SHEET);
assert.ok(outside.x >= 0 && outside.y <= 100, `касание за листом не обрезано: ${JSON.stringify(outside)}`);

// --- перевод координат туда и обратно -----------------------------------------

const middle = toSheetPoint({ x: 200, y: 150 }, SHEET);
assert.deepEqual(middle, { x: 50, y: 50 });
const back = toScreenPoint(middle, SHEET);
assert.deepEqual(back, { x: 200, y: 150 });

// Лист нулевого размера не должен ронять расчёт.
assert.deepEqual(toSheetPoint({ x: 10, y: 10 }, { width: 0, height: 0 }), { x: 0, y: 0 });

// --- набор точек ---------------------------------------------------------------

// Заметка — одна точка, и каждая новая заменяет прежнюю.
let note = appendPoint('note', [], { x: 10, y: 10 });
note = appendPoint('note', note, { x: 20, y: 20 });
assert.deepEqual(note, [{ x: 20, y: 20 }]);

// Линия — две, и вторая тянется за пальцем.
let line = appendPoint('line', [], { x: 10, y: 10 });
line = appendPoint('line', line, { x: 50, y: 50 });
line = appendPoint('line', line, { x: 80, y: 20 });
assert.deepEqual(line, [{ x: 10, y: 10 }, { x: 80, y: 20 }], 'линия набрала лишние точки');

// Свободная линия копит точки, но близкие отбрасывает.
let pencil: { x: number; y: number }[] = [];
for (const x of [10, 10.05, 10.1, 30, 50]) {
  pencil = appendPoint('freehand', pencil, { x, y: 10 });
}
assert.ok(pencil.length < 5, `штрих раздувается близкими точками: ${pencil.length}`);
assert.ok(pencil.length >= 3, `штрих потерял настоящие точки: ${pencil.length}`);

// --- когда штрих закончен ------------------------------------------------------

assert.equal(isComplete('note', [{ x: 1, y: 1 }]), true);
assert.equal(isComplete('line', [{ x: 1, y: 1 }]), false, 'линия из одной точки считается готовой');
assert.equal(
  isComplete('line', [{ x: 1, y: 1 }, { x: 1.1, y: 1.1 }]),
  false,
  'промах в одну точку сохраняется как линия',
);
assert.equal(isComplete('line', [{ x: 1, y: 1 }, { x: 40, y: 40 }]), true);
assert.equal(isComplete('freehand', [{ x: 1, y: 1 }]), false);

// --- линейка на непрямоугольном листе ------------------------------------------
// Главная проверка. Без пересчёта в пиксели одинаковые «10%» по ширине и по
// высоте дали бы одну длину, хотя на листе 4:3 это разные расстояния.

const horizontal = segmentLengthPct([{ x: 0, y: 0 }, { x: 10, y: 0 }], SHEET);
const vertical = segmentLengthPct([{ x: 0, y: 0 }, { x: 0, y: 10 }], SHEET);
assert.ok(
  Math.abs(horizontal - vertical) > 0.001,
  `линейка считает ширину и высоту одинаково: ${horizontal} и ${vertical}`,
);
// 10% ширины = 40px, 10% высоты = 30px — горизонталь длиннее ровно в 4/3.
assert.ok(
  Math.abs(horizontal / vertical - 4 / 3) < 0.01,
  `соотношение длин не совпадает с соотношением сторон: ${horizontal / vertical}`,
);
// На квадратном листе разницы быть не должно.
const square = { width: 300, height: 300 };
assert.ok(
  Math.abs(
    segmentLengthPct([{ x: 0, y: 0 }, { x: 10, y: 0 }], square)
      - segmentLengthPct([{ x: 0, y: 0 }, { x: 0, y: 10 }], square),
  ) < 1e-9,
  'на квадратном листе ширина и высота считаются по-разному',
);

// --- подпись линейки -----------------------------------------------------------

assert.equal(
  measureLabel(10, { ref_pct: 10, ref_m: 3 }),
  '3.00 м',
  'калибровка не переводится в метры',
);
assert.equal(
  measureLabel(20, { ref_pct: 10, ref_m: 3 }),
  '6.00 м',
  'метры не растут вместе с длиной',
);
// Без калибровки метров нет — и выдумывать их нельзя.
assert.equal(measureLabel(10, null), 'Задайте масштаб');
assert.equal(measureLabel(10, { ref_pct: 0, ref_m: 0 }), 'Задайте масштаб');
assert.equal(measureLabel(10, { ref_pct: 10, ref_m: 0 }), 'Задайте масштаб');

// --- стирание ------------------------------------------------------------------

const items: PlanAnnotation[] = [
  { id: 'a', kind: 'line', points: [{ x: 10, y: 10 }, { x: 20, y: 20 }], color: '#EF4444', stroke_width: 2 },
  { id: 'b', kind: 'note', points: [{ x: 80, y: 80 }], color: '#EF4444', stroke_width: 2 },
  { id: 'gone', kind: 'note', points: [{ x: 10, y: 10 }], color: '#EF4444', stroke_width: 2, deleted_at: '2026-09-18' },
];

assert.equal(visibleAnnotations(items).length, 2, 'стёртая пометка снова видна');

const hit = annotationAtPoint(items, { x: 10.5, y: 10.5 }, SHEET);
assert.equal(hit?.id, 'a', 'ластик не нашёл пометку под касанием');
assert.equal(
  annotationAtPoint(items, { x: 50, y: 50 }, SHEET),
  null,
  'ластик стирает пометку, до которой далеко',
);
// Стёртое ластик не трогает повторно.
const onDeleted = annotationAtPoint(items, { x: 10, y: 10 }, SHEET);
assert.notEqual(onDeleted?.id, 'gone', 'ластик цепляет уже стёртую пометку');

console.log('planAnnotationTools.test OK');
