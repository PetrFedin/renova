/**
 * Объёмный вид комнаты с поворотом на 360°.
 *
 * Вся геометрия — в `lib/domain/room3d` и покрыта тестами: проекция,
 * порядок граней, зажим тангажа, отклик на протаскивание. Здесь остаются
 * только рисование и жесты.
 *
 * Без 3D-движка это сделано намеренно. Настоящий движок на native требует
 * выхода из managed-сборки, а комната — это коробка: шесть граней, которые
 * рисуются обычными путями. Вращение от этого не страдает.
 *
 * Жесты на штатном `PanResponder` — по той же причине, что и в холсте
 * разметки: отдельная библиотека жестов тянет `@types/react` новее
 * объявленного в проекте и ломает типы в посторонних файлах.
 */
import { Fragment, useCallback, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme } from '@/constants/Theme';
import {
  DEFAULT_CAMERA,
  cameraAfterDrag,
  projectRoom,
  roomFactLines,
  visibleFaces,
  type Camera,
  type Face,
  type RoomFacts,
} from '@/lib/domain/room3d';

type LayoutEvent = { nativeEvent: { layout: { width: number; height: number } } };

// Пол темнее стен: так читается, где низ, даже на ракурсе почти сверху.
const FACE_FILL: Record<Face['kind'], string> = {
  floor: RenovaTheme.colors.accentMuted,
  ceiling: RenovaTheme.colors.surface,
  wall: RenovaTheme.colors.surfaceMuted,
};

export function Room3DView({
  room,
  facts = {},
  title,
}: {
  room: { lengthM: number; widthM: number; heightM: number };
  facts?: RoomFacts;
  title?: string;
}) {
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Камера на момент касания: смещения пальца считаются от неё, иначе
  // поворот накапливается рывками при каждом кадре жеста.
  const gestureStart = useRef<Camera>(DEFAULT_CAMERA);

  const onLayout = useCallback((event: LayoutEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
  }, []);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          gestureStart.current = camera;
        },
        onPanResponderMove: (_event, gesture) => {
          setCamera(cameraAfterDrag(gestureStart.current, gesture.dx, gesture.dy));
        },
      }),
    [camera],
  );

  const faces = useMemo(
    () =>
      size.width > 0 && size.height > 0
        ? projectRoom(room, camera, { width: size.width, height: size.height })
        : [],
    [room, camera, size.width, size.height],
  );

  const shown = useMemo(() => visibleFaces(faces), [faces]);
  const lines = useMemo(() => roomFactLines(room, facts), [room, facts]);

  return (
    <View style={styles.wrap}>
      {title ? <Text style={styles.title}>{title}</Text> : null}

      <View
        style={styles.stage}
        onLayout={onLayout}
        accessibilityRole="image"
        accessibilityLabel={`Объёмный вид комнаты. ${lines.join('. ')}. Поворот протаскиванием.`}
        {...responder.panHandlers}
      >
        {size.width > 0 ? (
          <Canvas style={StyleSheet.absoluteFill}>
            {shown.map((face) => {
              const path = Skia.Path.Make();
              path.moveTo(face.points[0].x, face.points[0].y);
              for (const point of face.points.slice(1)) path.lineTo(point.x, point.y);
              path.close();
              // Заливка и обводка — две отдельные фигуры: вложенный <Path>
              // в Skia рисуется как ещё одна фигура, а не как контур первой.
              return (
                <Fragment key={face.id}>
                  <Path path={path} color={FACE_FILL[face.kind]} />
                  <Path
                    path={path}
                    style="stroke"
                    strokeWidth={1.5}
                    strokeJoin="round"
                    color={RenovaTheme.colors.border}
                  />
                </Fragment>
              );
            })}
          </Canvas>
        ) : null}
      </View>

      <View style={styles.controls}>
        <PrimaryButton
          title="Сверху"
          variant="outline"
          compact
          accessibilityLabel="Посмотреть комнату сверху"
          onPress={() => setCamera({ yawDeg: camera.yawDeg, pitchDeg: 89 })}
        />
        <PrimaryButton
          title="Сбоку"
          variant="outline"
          compact
          accessibilityLabel="Посмотреть комнату сбоку"
          onPress={() => setCamera({ yawDeg: camera.yawDeg, pitchDeg: 15 })}
        />
        <PrimaryButton
          title="Сбросить"
          variant="outline"
          compact
          accessibilityLabel="Вернуть исходный ракурс"
          onPress={() => setCamera(DEFAULT_CAMERA)}
        />
      </View>

      <View style={styles.facts}>
        {lines.map((line) => (
          <Text key={line} style={styles.fact}>
            {line}
          </Text>
        ))}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  wrap: {
    gap: RenovaTheme.spacing.sm,
  },
  title: {
    fontSize: RenovaTheme.fontSize.h3,
    fontWeight: RenovaTheme.fontWeight.medium,
    color: RenovaTheme.colors.text,
  },
  stage: {
    height: 240,
    borderRadius: RenovaTheme.radius.lg,
    backgroundColor: RenovaTheme.colors.surface,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    overflow: 'hidden',
  },
  controls: {
    flexDirection: 'row',
    gap: RenovaTheme.spacing.sm,
    flexWrap: 'wrap',
  },
  facts: {
    gap: 2,
  },
  fact: {
    fontSize: RenovaTheme.fontSize.caption,
    color: RenovaTheme.colors.textMuted,
  },
});
