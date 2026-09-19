/**
 * Объёмный вид комнаты: геометрия отдельно от отрисовки.
 *
 * Здесь нет ни Skia, ни React — только математика, которую можно проверить
 * тестами. Комната берётся из тех данных, что уже есть: длина, ширина,
 * высота. Никакой 3D-движок для этого не нужен и на native его без выхода
 * из managed-сборки всё равно не запустить.
 *
 * Система координат мира: X — длина, Y — ширина, Z — высота вверх.
 * Начало в углу пола. Камера смотрит на центр комнаты, вращается вокруг
 * вертикальной оси (рыскание, 0…360°) и поднимается над полом (тангаж).
 */

export type Vec3 = { x: number; y: number; z: number };
export type Point2 = { x: number; y: number };

export type RoomBox = {
  lengthM: number;
  widthM: number;
  heightM: number;
};

/** Грань комнаты — что именно пользователь видит и что подписать. */
export type FaceKind = 'floor' | 'ceiling' | 'wall';

export type Face = {
  id: string;
  kind: FaceKind;
  /** Человеческое название: «Пол», «Стена 3,2 м» и так далее. */
  label: string;
  /** Вершины в порядке обхода, уже спроецированные на экран. */
  points: Point2[];
  /** Площадь грани в м² — то, из чего считается смета. */
  areaSqM: number;
  /** Глубина центра грани: больше — дальше от камеры. */
  depth: number;
  /** Грань повёрнута к зрителю лицом. */
  facingCamera: boolean;
};

export type Camera = {
  /** Рыскание в градусах: полный оборот вокруг комнаты. */
  yawDeg: number;
  /** Тангаж в градусах: 0 — с уровня пола, 90 — строго сверху. */
  pitchDeg: number;
};

export const PITCH_MIN_DEG = 5;
export const PITCH_MAX_DEG = 89;

/** Рыскание живёт по кругу: 370° — это 10°, −10° — это 350°. */
export function normalizeYaw(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * Тангаж по кругу не ходит: за горизонтом камера оказывается под полом,
 * а над зенитом изображение переворачивается. Поэтому именно зажим.
 */
export function clampPitch(deg: number): number {
  if (Number.isNaN(deg)) return PITCH_MIN_DEG;
  return Math.min(PITCH_MAX_DEG, Math.max(PITCH_MIN_DEG, deg));
}

const RAD = Math.PI / 180;

function rotate(point: Vec3, camera: Camera): Vec3 {
  const yaw = normalizeYaw(camera.yawDeg) * RAD;
  const pitch = clampPitch(camera.pitchDeg) * RAD;

  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const x = point.x * cosYaw - point.y * sinYaw;
  const y = point.x * sinYaw + point.y * cosYaw;

  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  return {
    x,
    y: y * cosPitch - point.z * sinPitch,
    z: y * sinPitch + point.z * cosPitch,
  };
}

function centroid(points: Vec3[]): Vec3 {
  const sum = points.reduce(
    (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y, z: acc.z + p.z }),
    { x: 0, y: 0, z: 0 },
  );
  return { x: sum.x / points.length, y: sum.y / points.length, z: sum.z / points.length };
}

/** Знаковая площадь многоугольника: отрицательная — обход по часовой. */
export function signedArea(points: Point2[]): number {
  let total = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    total += a.x * b.y - b.x * a.y;
  }
  return total / 2;
}

function metres(value: number): string {
  // Запятая как разделитель — так пишут размеры в проектной документации.
  return value.toFixed(1).replace('.', ',');
}

type FaceSpec = {
  id: string;
  kind: FaceKind;
  label: string;
  areaSqM: number;
  corners: Vec3[];
};

function faceSpecs(room: RoomBox): FaceSpec[] {
  const { lengthM: l, widthM: w, heightM: h } = room;
  // Центрируем коробку, чтобы вращение шло вокруг середины комнаты,
  // а не вокруг угла — иначе комната уезжает с экрана при повороте.
  const x0 = -l / 2;
  const x1 = l / 2;
  const y0 = -w / 2;
  const y1 = w / 2;
  const z0 = -h / 2;
  const z1 = h / 2;

  return [
    {
      id: 'floor',
      kind: 'floor',
      label: `Пол ${metres(l * w)} м²`,
      areaSqM: l * w,
      corners: [
        { x: x0, y: y0, z: z0 },
        { x: x1, y: y0, z: z0 },
        { x: x1, y: y1, z: z0 },
        { x: x0, y: y1, z: z0 },
      ],
    },
    {
      id: 'ceiling',
      kind: 'ceiling',
      label: `Потолок ${metres(l * w)} м²`,
      areaSqM: l * w,
      corners: [
        { x: x0, y: y0, z: z1 },
        { x: x0, y: y1, z: z1 },
        { x: x1, y: y1, z: z1 },
        { x: x1, y: y0, z: z1 },
      ],
    },
    {
      id: 'wall-north',
      kind: 'wall',
      label: `Стена ${metres(l)} × ${metres(h)} м`,
      areaSqM: l * h,
      corners: [
        { x: x0, y: y1, z: z0 },
        { x: x1, y: y1, z: z0 },
        { x: x1, y: y1, z: z1 },
        { x: x0, y: y1, z: z1 },
      ],
    },
    {
      id: 'wall-south',
      kind: 'wall',
      label: `Стена ${metres(l)} × ${metres(h)} м`,
      areaSqM: l * h,
      corners: [
        { x: x1, y: y0, z: z0 },
        { x: x0, y: y0, z: z0 },
        { x: x0, y: y0, z: z1 },
        { x: x1, y: y0, z: z1 },
      ],
    },
    {
      id: 'wall-east',
      kind: 'wall',
      label: `Стена ${metres(w)} × ${metres(h)} м`,
      areaSqM: w * h,
      corners: [
        { x: x1, y: y1, z: z0 },
        { x: x1, y: y0, z: z0 },
        { x: x1, y: y0, z: z1 },
        { x: x1, y: y1, z: z1 },
      ],
    },
    {
      id: 'wall-west',
      kind: 'wall',
      label: `Стена ${metres(w)} × ${metres(h)} м`,
      areaSqM: w * h,
      corners: [
        { x: x0, y: y0, z: z0 },
        { x: x0, y: y1, z: z0 },
        { x: x0, y: y1, z: z1 },
        { x: x0, y: y0, z: z1 },
      ],
    },
  ];
}

export type ProjectOptions = {
  /** Размер холста в точках. */
  width: number;
  height: number;
  /** Доля холста, которую занимает комната. */
  fill?: number;
};

/**
 * Проецирует комнату на холст.
 *
 * Масштаб подбирается по фактическому размеру спроецированной коробки, а не
 * по её габаритам в метрах: при повороте диагональ длиннее любой стороны, и
 * фиксированный масштаб выпускал бы углы за край холста.
 *
 * Грани возвращаются отсортированными от дальней к ближней — рисовать их
 * нужно в этом порядке, тогда ближние перекроют дальние без буфера глубины.
 */
export function projectRoom(
  room: RoomBox,
  camera: Camera,
  options: ProjectOptions,
): Face[] {
  const fill = options.fill ?? 0.8;
  const specs = faceSpecs(room);

  const rotated = specs.map((spec) => ({
    spec,
    corners: spec.corners.map((corner) => rotate(corner, camera)),
  }));

  const all = rotated.flatMap((face) => face.corners);
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);

  // Вырожденная комната (нулевой размер) не должна давать деления на ноль.
  const scale = Math.min(
    spanX > 0 ? (options.width * fill) / spanX : Number.POSITIVE_INFINITY,
    spanY > 0 ? (options.height * fill) / spanY : Number.POSITIVE_INFINITY,
  );
  const safeScale = Number.isFinite(scale) ? scale : 1;

  const cx = options.width / 2;
  const cy = options.height / 2;

  const faces = rotated.map(({ spec, corners }) => {
    const points = corners.map((corner) => ({
      // Экранный Y растёт вниз, мировой — вверх, отсюда минус.
      x: cx + corner.x * safeScale,
      y: cy - corner.y * safeScale,
    }));
    const middle = centroid(corners);
    return {
      id: spec.id,
      kind: spec.kind,
      label: spec.label,
      areaSqM: spec.areaSqM,
      points,
      depth: middle.z,
      // Вершины заданы против часовой стрелки снаружи. После переворота
      // экранной оси Y лицевая грань даёт отрицательную знаковую площадь.
      facingCamera: signedArea(points) < 0,
    };
  });

  return faces.sort((a, b) => a.depth - b.depth);
}

/** Грани, которые действительно видно — только их имеет смысл подписывать. */
export function visibleFaces(faces: Face[]): Face[] {
  return faces.filter((face) => face.facingCamera);
}

/**
 * Куда сместить камеру при протаскивании пальцем.
 *
 * Горизонталь — рыскание, вертикаль — тангаж. Коэффициент подобран так,
 * чтобы протаскивание на ширину экрана давало примерно половину оборота:
 * полный оборот одним движением слишком резкий, треть — слишком вязкая.
 */
export const DRAG_DEG_PER_POINT = 0.5;

export function cameraAfterDrag(
  camera: Camera,
  dx: number,
  dy: number,
): Camera {
  return {
    yawDeg: normalizeYaw(camera.yawDeg + dx * DRAG_DEG_PER_POINT),
    // Тянем вниз — смотрим сверху: так же ведёт себя вращение в картах.
    pitchDeg: clampPitch(camera.pitchDeg + dy * DRAG_DEG_PER_POINT),
  };
}

export const DEFAULT_CAMERA: Camera = { yawDeg: 35, pitchDeg: 25 };

/** Подписи с количествами по комнате — то, чего не видно в геометрии. */
export type RoomFacts = {
  outletsCount?: number | null;
  switchesCount?: number | null;
  plumbingPoints?: number | null;
};

export function roomFactLines(room: RoomBox, facts: RoomFacts): string[] {
  const lines = [
    `${metres(room.lengthM)} × ${metres(room.widthM)} м, высота ${metres(room.heightM)} м`,
    `Пол ${metres(room.lengthM * room.widthM)} м²`,
    `Стены ${metres(2 * (room.lengthM + room.widthM) * room.heightM)} м²`,
  ];
  if (facts.outletsCount) lines.push(`Розетки: ${facts.outletsCount}`);
  if (facts.switchesCount) lines.push(`Выключатели: ${facts.switchesCount}`);
  if (facts.plumbingPoints) lines.push(`Точки водоснабжения: ${facts.plumbingPoints}`);
  return lines;
}
