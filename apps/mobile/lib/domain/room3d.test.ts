/**
 * Геометрия объёмного вида комнаты.
 *
 * Проверяется то, что ломается молча: комната уезжает за край при повороте,
 * дальняя стена рисуется поверх ближней, «вид сверху» показывает потолок,
 * тангаж уходит под пол. Всё это на экране выглядит как «просто криво» и
 * без теста ловится только глазами.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_CAMERA,
  PITCH_MAX_DEG,
  PITCH_MIN_DEG,
  cameraAfterDrag,
  clampPitch,
  normalizeYaw,
  projectRoom,
  roomFactLines,
  signedArea,
  visibleFaces,
  type Face,
} from './room3d';

const ROOM = { lengthM: 4, widthM: 3, heightM: 2.7 };
const CANVAS = { width: 320, height: 240 };

function byId(faces: Face[], id: string): Face {
  const face = faces.find((f) => f.id === id);
  assert.ok(face, `грань ${id} не найдена`);
  return face;
}

test('рыскание ходит по кругу', () => {
  assert.equal(normalizeYaw(370), 10);
  assert.equal(normalizeYaw(-10), 350);
  assert.equal(normalizeYaw(0), 0);
  assert.equal(normalizeYaw(720), 0);
});

test('тангаж зажат, а не закольцован', () => {
  // За горизонтом камера оказалась бы под полом, за зенитом — вверх ногами.
  assert.equal(clampPitch(-40), PITCH_MIN_DEG);
  assert.equal(clampPitch(140), PITCH_MAX_DEG);
  assert.equal(clampPitch(30), 30);
});

test('комната не выходит за холст ни при каком повороте', () => {
  for (let yaw = 0; yaw < 360; yaw += 5) {
    for (const pitch of [PITCH_MIN_DEG, 25, 45, PITCH_MAX_DEG]) {
      const faces = projectRoom(ROOM, { yawDeg: yaw, pitchDeg: pitch }, CANVAS);
      for (const face of faces) {
        for (const point of face.points) {
          assert.ok(
            point.x >= 0 && point.x <= CANVAS.width,
            `поворот ${yaw}°/${pitch}°: x=${point.x.toFixed(1)} вне холста`,
          );
          assert.ok(
            point.y >= 0 && point.y <= CANVAS.height,
            `поворот ${yaw}°/${pitch}°: y=${point.y.toFixed(1)} вне холста`,
          );
        }
      }
    }
  }
});

test('грани отсортированы от дальней к ближней', () => {
  const faces = projectRoom(ROOM, DEFAULT_CAMERA, CANVAS);
  for (let i = 1; i < faces.length; i += 1) {
    assert.ok(
      faces[i - 1].depth <= faces[i].depth,
      'ближняя грань нарисуется раньше дальней и будет ею перекрыта',
    );
  }
});

test('у комнаты шесть граней и площади сходятся с размерами', () => {
  const faces = projectRoom(ROOM, DEFAULT_CAMERA, CANVAS);
  assert.equal(faces.length, 6);

  assert.equal(byId(faces, 'floor').areaSqM, 12);
  assert.equal(byId(faces, 'ceiling').areaSqM, 12);

  const walls = faces.filter((f) => f.kind === 'wall');
  const wallArea = walls.reduce((sum, f) => sum + f.areaSqM, 0);
  // Периметр × высота: (4+3)×2 × 2,7
  assert.ok(Math.abs(wallArea - 2 * (4 + 3) * 2.7) < 1e-9);
});

test('сверху видно пол, а не потолок', () => {
  // Взгляд почти вертикально вниз: пользователь ждёт планировку.
  const faces = projectRoom(ROOM, { yawDeg: 0, pitchDeg: PITCH_MAX_DEG }, CANVAS);
  const visible = visibleFaces(faces).map((f) => f.id);
  assert.ok(visible.includes('floor'), 'пол должен быть виден сверху');
  assert.ok(!visible.includes('ceiling'), 'потолок закрыл бы всю комнату');
});

test('сбоку видно ровно две стены из четырёх', () => {
  // На угловом ракурсе внешне видны две смежные стены: остальные — с изнанки.
  const faces = projectRoom(ROOM, { yawDeg: 45, pitchDeg: 25 }, CANVAS);
  const walls = visibleFaces(faces).filter((f) => f.kind === 'wall');
  assert.equal(walls.length, 2, `видно стен: ${walls.map((w) => w.id).join(', ')}`);
});

test('видимых граней всегда три: пол и две стены', () => {
  for (let yaw = 0; yaw < 360; yaw += 7) {
    const faces = projectRoom(ROOM, { yawDeg: yaw, pitchDeg: 30 }, CANVAS);
    const visible = visibleFaces(faces);
    assert.ok(
      visible.length >= 2 && visible.length <= 3,
      `поворот ${yaw}°: видимых граней ${visible.length}`,
    );
  }
});

test('знаковая площадь различает направление обхода', () => {
  const ccw = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  assert.ok(signedArea(ccw) > 0);
  assert.ok(signedArea([...ccw].reverse()) < 0);
});

test('протаскивание вращает, а не дёргает', () => {
  const start = { yawDeg: 0, pitchDeg: 30 };
  const after = cameraAfterDrag(start, 100, 0);
  assert.equal(after.yawDeg, 50);
  assert.equal(after.pitchDeg, 30, 'горизонтальное движение не трогает тангаж');

  const tilted = cameraAfterDrag(start, 0, 100);
  assert.equal(tilted.yawDeg, 0, 'вертикальное движение не трогает рыскание');
  assert.equal(tilted.pitchDeg, 80);
});

test('полный оборот возвращает в ту же точку', () => {
  let camera = { yawDeg: 0, pitchDeg: 30 };
  // 360° ровно: 720 точек по 0,5° на точку.
  camera = cameraAfterDrag(camera, 720, 0);
  assert.equal(camera.yawDeg, 0);
});

test('протаскивание вниз упирается в вид сверху, а не проваливается', () => {
  let camera = { yawDeg: 0, pitchDeg: 30 };
  for (let i = 0; i < 20; i += 1) camera = cameraAfterDrag(camera, 0, 100);
  assert.equal(camera.pitchDeg, PITCH_MAX_DEG);

  for (let i = 0; i < 40; i += 1) camera = cameraAfterDrag(camera, 0, -100);
  assert.equal(camera.pitchDeg, PITCH_MIN_DEG);
});

test('вырожденная комната не роняет расчёт', () => {
  const faces = projectRoom({ lengthM: 0, widthM: 0, heightM: 0 }, DEFAULT_CAMERA, CANVAS);
  assert.equal(faces.length, 6);
  for (const face of faces) {
    for (const point of face.points) {
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
    }
  }
});

test('подписи размеров пишутся через запятую, как в документации', () => {
  const lines = roomFactLines(ROOM, { outletsCount: 6, switchesCount: 2, plumbingPoints: 0 });
  assert.equal(lines[0], '4,0 × 3,0 м, высота 2,7 м');
  assert.equal(lines[1], 'Пол 12,0 м²');
  assert.equal(lines[2], 'Стены 37,8 м²');
  assert.ok(lines.includes('Розетки: 6'));
  assert.ok(lines.includes('Выключатели: 2'));
  assert.ok(
    !lines.some((l) => l.startsWith('Точки водоснабжения')),
    'нулевое количество — не факт, его не показываем',
  );
});
