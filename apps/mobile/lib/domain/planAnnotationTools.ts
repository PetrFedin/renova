/**
 * Инструменты разметки плана — чистая логика, без отрисовки.
 *
 * Здесь всё, что можно проверить тестом: какой инструмент сколько точек
 * ожидает, когда штрих закончен, как считается длина, что показывать в
 * подписи. Холст остаётся тонким слоем поверх — он только рисует то, что
 * посчитано здесь.
 *
 * Координаты — доли листа в процентах (0..100), как их хранит бэкенд. Так
 * разметка одинаково ложится на телефон, планшет и на перезалитый скан
 * большего разрешения.
 */

/** Инструменты палитры. Значения совпадают с `AnnotationKind` бэкенда. */
export type PlanTool =
  | 'freehand'
  | 'marker'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'measure'
  | 'note'
  | 'text';

export type PlanPoint = { x: number; y: number };

export type PlanAnnotation = {
  id: string;
  kind: PlanTool;
  points: PlanPoint[];
  color: string;
  stroke_width: number;
  text?: string | null;
  measured_m?: number | null;
  author_id?: string;
  deleted_at?: string | null;
};

/** Сколько точек инструмент набирает, прежде чем штрих закончен. */
export const TOOL_POINTS: Record<PlanTool, 'one' | 'two' | 'many'> = {
  freehand: 'many',
  marker: 'many',
  line: 'two',
  arrow: 'two',
  rect: 'two',
  ellipse: 'two',
  measure: 'two',
  note: 'one',
  text: 'one',
};

/** Подпись инструмента в палитре. */
export const TOOL_LABEL: Record<PlanTool, string> = {
  freehand: 'Карандаш',
  marker: 'Маркер',
  line: 'Линия',
  arrow: 'Стрелка',
  rect: 'Прямоугольник',
  ellipse: 'Овал',
  measure: 'Линейка',
  note: 'Заметка',
  text: 'Текст',
};

/** Толщина по умолчанию. Маркер заметно шире карандаша — он для выделения. */
export const TOOL_STROKE: Record<PlanTool, number> = {
  freehand: 2,
  marker: 12,
  line: 2,
  arrow: 2,
  rect: 2,
  ellipse: 2,
  measure: 2,
  note: 2,
  text: 2,
};

/** Маркер полупрозрачен: под ним должен читаться чертёж. */
export const TOOL_OPACITY: Record<PlanTool, number> = {
  freehand: 1,
  marker: 0.35,
  line: 1,
  arrow: 1,
  rect: 1,
  ellipse: 1,
  measure: 1,
  note: 1,
  text: 1,
};

const PCT_MIN = 0;
const PCT_MAX = 100;

/** Точка не должна уезжать за лист: вернуть её оттуда нечем. */
export function clampToSheet(point: PlanPoint): PlanPoint {
  return {
    x: Math.min(PCT_MAX, Math.max(PCT_MIN, point.x)),
    y: Math.min(PCT_MAX, Math.max(PCT_MIN, point.y)),
  };
}

/** Перевод касания в доли листа. */
export function toSheetPoint(
  touch: { x: number; y: number },
  sheet: { width: number; height: number },
): PlanPoint {
  if (sheet.width <= 0 || sheet.height <= 0) return { x: 0, y: 0 };
  return clampToSheet({
    x: (touch.x / sheet.width) * 100,
    y: (touch.y / sheet.height) * 100,
  });
}

/** Обратный перевод — для отрисовки. */
export function toScreenPoint(
  point: PlanPoint,
  sheet: { width: number; height: number },
): { x: number; y: number } {
  return { x: (point.x / 100) * sheet.width, y: (point.y / 100) * sheet.height };
}

/**
 * Добавить точку к текущему штриху.
 *
 * Для инструментов из двух точек вторая точка всё время заменяется, пока
 * палец ведёт: пользователь видит, какой получится линия, ещё до отпускания.
 */
export function appendPoint(
  tool: PlanTool,
  current: PlanPoint[],
  next: PlanPoint,
): PlanPoint[] {
  const point = clampToSheet(next);
  const shape = TOOL_POINTS[tool];
  if (shape === 'one') return [point];
  if (shape === 'two') return current.length === 0 ? [point] : [current[0], point];
  // Для свободной линии близкие точки не добавляем: иначе штрих раздувается
  // тысячами координат, а на глаз разницы нет.
  const last = current[current.length - 1];
  if (last && Math.hypot(last.x - point.x, last.y - point.y) < 0.2) return current;
  return [...current, point];
}

/** Штрих можно сохранять. */
export function isComplete(tool: PlanTool, points: PlanPoint[]): boolean {
  const shape = TOOL_POINTS[tool];
  if (shape === 'one') return points.length >= 1;
  if (shape === 'two') return points.length >= 2 && !isDegenerate(points);
  return points.length >= 2;
}

/** Двойное касание в одну точку — это не линия, а промах. */
function isDegenerate(points: PlanPoint[]): boolean {
  if (points.length < 2) return true;
  const [a, b] = points;
  return Math.hypot(a.x - b.x, a.y - b.y) < 0.5;
}

/**
 * Длина отрезка в долях листа с учётом соотношения сторон.
 *
 * Без пересчёта в пиксели проценты по ширине и по высоте — разные величины,
 * и линейка врёт на любом непрямоугольном листе. Та же формула, что на
 * сервере: он считает метры этой же длиной.
 */
export function segmentLengthPct(
  points: PlanPoint[],
  sheet: { width: number; height: number },
): number {
  if (points.length < 2) return 0;
  const [a, b] = points;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (sheet.width > 0 && sheet.height > 0) {
    const lengthPx = Math.hypot((dx / 100) * sheet.width, (dy / 100) * sheet.height);
    const diagonalPx = Math.hypot(sheet.width, sheet.height);
    return (lengthPx / diagonalPx) * 100;
  }
  return Math.hypot(dx, dy);
}

/**
 * Что показать рядом с линейкой.
 *
 * Без калибровки метров нет — и выдумывать их нельзя. Показываем долю листа
 * и говорим, что делать, чтобы появились метры.
 */
export function measureLabel(
  lengthPct: number,
  calibration: { ref_pct?: number | null; ref_m?: number | null } | null,
): string {
  const refPct = calibration?.ref_pct ?? 0;
  const refM = calibration?.ref_m ?? 0;
  if (refPct > 0 && refM > 0 && lengthPct > 0) {
    const metres = (lengthPct / refPct) * refM;
    return `${metres.toFixed(2)} м`;
  }
  return 'Задайте масштаб';
}

/** Стереть — это пометить удалённым, а не вычеркнуть из списка. */
export function visibleAnnotations(items: PlanAnnotation[]): PlanAnnotation[] {
  return items.filter((item) => !item.deleted_at);
}

/**
 * Какой штрих попадёт под ластик.
 *
 * Берём ближайший в пределах допуска, а не все подряд: ластик, стирающий
 * несколько пометок за одно касание, сделает больше вреда, чем пользы.
 */
export function annotationAtPoint(
  items: PlanAnnotation[],
  point: PlanPoint,
  sheet: { width: number; height: number },
  tolerancePct = 2.5,
): PlanAnnotation | null {
  let best: { item: PlanAnnotation; distance: number } | null = null;
  for (const item of visibleAnnotations(items)) {
    for (const candidate of item.points) {
      const dx = ((candidate.x - point.x) / 100) * sheet.width;
      const dy = ((candidate.y - point.y) / 100) * sheet.height;
      const distance = Math.hypot(dx, dy);
      const tolerancePx = (tolerancePct / 100) * Math.hypot(sheet.width, sheet.height);
      if (distance <= tolerancePx && (!best || distance < best.distance)) {
        best = { item, distance };
      }
    }
  }
  return best?.item ?? null;
}
