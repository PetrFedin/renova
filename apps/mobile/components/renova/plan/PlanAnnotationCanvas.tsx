/**
 * Холст разметки плана: рисование поверх чертежа.
 *
 * Слой отрисовки намеренно тонкий. Всё, что можно посчитать, посчитано в
 * `lib/domain/planAnnotationTools` и покрыто тестами: сколько точек набирает
 * инструмент, когда штрих закончен, как считать длину с учётом соотношения
 * сторон листа, что писать рядом с линейкой. Здесь остаётся только рисование
 * и жесты.
 *
 * Жесты — на штатном `PanResponder`. Отдельная библиотека жестов тянет за
 * собой `@types/react` новее того, что объявлен в проекте, и ломает типы в
 * файлах, к разметке отношения не имеющих. Для рисования это не нужно.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { Image, PanResponder, StyleSheet, Text, View } from 'react-native';
import { Canvas, Circle, Path, Skia } from '@shopify/react-native-skia';
import { RenovaTheme } from '@/constants/Theme';
import {
  TOOL_OPACITY,
  TOOL_POINTS,
  TOOL_STROKE,
  annotationAtPoint,
  appendPoint,
  isComplete,
  measureLabel,
  segmentLengthPct,
  toScreenPoint,
  toSheetPoint,
  visibleAnnotations,
  type PlanAnnotation,
  type PlanPoint,
  type PlanTool,
} from '@/lib/domain/planAnnotationTools';

/**
 * Узкие типы событий вместо импорта из react-native: в проекте так уже
 * принято (см. MapLayoutEvent в FloorPlanPanel, portalLayoutY в PortalScreen),
 * и это не зависит от того, как именно типизирует события текущая версия RN.
 */
type LayoutEvent = { nativeEvent?: { layout?: { width?: number; height?: number } } };
type TouchEvent = { nativeEvent?: { locationX?: number; locationY?: number } };

function touchPoint(event: TouchEvent): { x: number; y: number } {
  return {
    x: typeof event.nativeEvent?.locationX === 'number' ? event.nativeEvent.locationX : 0,
    y: typeof event.nativeEvent?.locationY === 'number' ? event.nativeEvent.locationY : 0,
  };
}

type Props = {
  /** Картинка листа. */
  imageUrl: string;
  items: PlanAnnotation[];
  tool: PlanTool | 'eraser';
  color: string;
  calibration: { ref_pct?: number | null; ref_m?: number | null } | null;
  /** Штрих закончен — сохранить. */
  onFinish: (kind: PlanTool, points: PlanPoint[]) => void;
  /** Ластик коснулся пометки. */
  onErase: (annotation: PlanAnnotation) => void;
  disabled?: boolean;
};

export function PlanAnnotationCanvas({
  imageUrl,
  items,
  tool,
  color,
  calibration,
  onFinish,
  onErase,
  disabled,
}: Props) {
  const [sheet, setSheet] = useState({ width: 0, height: 0 });
  const [draft, setDraft] = useState<PlanPoint[]>([]);
  // Инструмент и точки нужны внутри PanResponder, который создаётся один раз.
  const draftRef = useRef<PlanPoint[]>([]);
  const toolRef = useRef(tool);
  const sheetRef = useRef(sheet);
  const itemsRef = useRef(items);
  toolRef.current = tool;
  sheetRef.current = sheet;
  itemsRef.current = items;

  const onLayout = useCallback((event: LayoutEvent) => {
    const width = event.nativeEvent?.layout?.width;
    const height = event.nativeEvent?.layout?.height;
    if (typeof width === 'number' && typeof height === 'number') setSheet({ width, height });
  }, []);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled,
        onMoveShouldSetPanResponder: () => !disabled,
        onPanResponderGrant: (event: TouchEvent) => {
          const point = toSheetPoint(touchPoint(event), sheetRef.current);
          if (toolRef.current === 'eraser') {
            const hit = annotationAtPoint(itemsRef.current, point, sheetRef.current);
            if (hit) onErase(hit);
            return;
          }
          draftRef.current = appendPoint(toolRef.current, [], point);
          setDraft(draftRef.current);
        },
        onPanResponderMove: (event: TouchEvent) => {
          if (toolRef.current === 'eraser') return;
          const point = toSheetPoint(touchPoint(event), sheetRef.current);
          draftRef.current = appendPoint(toolRef.current, draftRef.current, point);
          setDraft(draftRef.current);
        },
        onPanResponderRelease: () => {
          const current = toolRef.current;
          if (current === 'eraser') return;
          const points = draftRef.current;
          draftRef.current = [];
          setDraft([]);
          if (isComplete(current, points)) onFinish(current, points);
        },
        onPanResponderTerminate: () => {
          draftRef.current = [];
          setDraft([]);
        },
      }),
    [disabled, onErase, onFinish],
  );

  const visible = useMemo(() => visibleAnnotations(items), [items]);

  return (
    <View style={s.wrap} onLayout={onLayout} {...responder.panHandlers}>
      <Image source={{ uri: imageUrl }} style={s.sheet} resizeMode="contain" />
      {sheet.width > 0 ? (
        <Canvas style={StyleSheet.absoluteFill}>
          {visible.map((item) => (
            <AnnotationShape key={item.id} item={item} sheet={sheet} />
          ))}
          {draft.length > 0 && tool !== 'eraser' ? (
            <AnnotationShape
              item={{
                id: 'draft',
                kind: tool,
                points: draft,
                color,
                stroke_width: TOOL_STROKE[tool],
              }}
              sheet={sheet}
            />
          ) : null}
        </Canvas>
      ) : null}

      {/* Линейка показывает длину прямо во время ведения — иначе непонятно,
          что именно меряешь. */}
      {tool === 'measure' && draft.length >= 2 ? (
        <View style={s.badge} pointerEvents="none">
          <Text style={s.badgeText}>
            {measureLabel(segmentLengthPct(draft, sheet), calibration)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function AnnotationShape({
  item,
  sheet,
}: {
  item: PlanAnnotation;
  sheet: { width: number; height: number };
}) {
  const screen = item.points.map((point) => toScreenPoint(point, sheet));
  const opacity = TOOL_OPACITY[item.kind] ?? 1;

  // Точечные виды — заметка и текст: рисуем узнаваемый маркер.
  if (TOOL_POINTS[item.kind] === 'one') {
    const point = screen[0];
    if (!point) return null;
    return <Circle cx={point.x} cy={point.y} r={7} color={item.color} opacity={opacity} />;
  }

  const path = Skia.Path.Make();
  if (item.kind === 'rect' && screen.length >= 2) {
    const [a, b] = screen;
    path.addRect({
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y),
    });
  } else if (item.kind === 'ellipse' && screen.length >= 2) {
    const [a, b] = screen;
    path.addOval({
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y),
    });
  } else {
    const [first, ...rest] = screen;
    if (!first) return null;
    path.moveTo(first.x, first.y);
    for (const point of rest) path.lineTo(point.x, point.y);
    // Стрелка: два коротких пера у последней точки.
    if (item.kind === 'arrow' && screen.length >= 2) {
      const from = screen[screen.length - 2];
      const to = screen[screen.length - 1];
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const wing = 12;
      for (const side of [-1, 1]) {
        const a = angle + side * (Math.PI / 6) + Math.PI;
        path.moveTo(to.x, to.y);
        path.lineTo(to.x + Math.cos(a) * wing, to.y + Math.sin(a) * wing);
      }
    }
  }

  return (
    <Path
      path={path}
      color={item.color}
      style="stroke"
      strokeWidth={item.stroke_width}
      strokeCap="round"
      strokeJoin="round"
      opacity={opacity}
    />
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.surfaceMuted },
  sheet: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  badge: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    backgroundColor: RenovaTheme.colors.text,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RenovaTheme.radius.pill,
  },
  badgeText: { color: RenovaTheme.colors.inverseText, fontWeight: '700', fontSize: 13 },
});
