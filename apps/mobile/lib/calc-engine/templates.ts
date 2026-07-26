import type { RenovationType, RoomMetrics, WorkLine, MaterialLine } from './types';
import { quantityWithWaste } from './estimate';

const PAINT_COATS = 2;
const PAINT_COVERAGE_SQ_M_PER_LITER = 8;
const KITCHEN_BACKSPLASH_WALL_SHARE = 0.4;
const WATERPROOFING_KG_PER_SQ_M_TWO_COATS = 1.4;
const ELECTRICAL_POINT_RATE = 850;
const PLUMBING_POINT_RATE = 2500;

export interface EngineeringPoints {
  outletsCount?: number;
  plumbingPoints?: number;
}

/** Шаблоны работ MVP — генерируют строки сметы из метрик комнаты */
export function generateTemplateLines(
  type: RenovationType,
  roomId: string,
  metrics: RoomMetrics,
  engineering: EngineeringPoints = {},
): { works: WorkLine[]; materials: MaterialLine[] } {
  const base = (() => {
    switch (type) {
      case 'cosmetic':
        return cosmeticTemplate(roomId, metrics);
      case 'bathroom':
        return bathroomTemplate(roomId, metrics);
      case 'kitchen':
        return kitchenTemplate(roomId, metrics);
      case 'capital':
        return capitalTemplate(roomId, metrics);
      default:
        return cosmeticTemplate(roomId, metrics);
    }
  })();

  base.works.push(...engineeringWorkLines(roomId, engineering));
  return base;
}

function cosmeticTemplate(roomId: string, m: RoomMetrics): { works: WorkLine[]; materials: MaterialLine[] } {
  const paintCoverageSqM = m.wallSqM * PAINT_COATS;
  const paintLiters = quantityWithWaste(
    paintCoverageSqM / PAINT_COVERAGE_SQ_M_PER_LITER,
    'paint',
  );

  return {
    works: [
      { id: `${roomId}-w1`, name: 'Подготовка стен', unit: 'm2', quantity: m.wallSqM, ratePerUnit: 180, roomId },
      { id: `${roomId}-w2`, name: 'Покраска стен 2 слоя', unit: 'm2', quantity: m.wallSqM, ratePerUnit: 320, roomId },
      { id: `${roomId}-w3`, name: 'Укладка ламината', unit: 'm2', quantity: m.floorSqM, ratePerUnit: 450, roomId },
    ],
    materials: [
      { id: `${roomId}-m1`, name: 'Краска интерьерная', unit: 'l', quantity: round2(paintLiters), unitPrice: 890, roomId },
      { id: `${roomId}-m2`, name: 'Ламинат', unit: 'm2', quantity: quantityWithWaste(m.floorSqM, 'default'), unitPrice: 1200, roomId },
    ],
  };
}

function bathroomTemplate(roomId: string, m: RoomMetrics): { works: WorkLine[]; materials: MaterialLine[] } {
  const waterproofingSqM = round2(m.wallSqM + m.floorSqM);
  const tileQty = quantityWithWaste(waterproofingSqM, 'tile');
  const waterproofingKg = round2(waterproofingSqM * WATERPROOFING_KG_PER_SQ_M_TWO_COATS);

  return {
    works: [
      { id: `${roomId}-w1`, name: 'Гидроизоляция в 2 слоя', unit: 'm2', quantity: waterproofingSqM, ratePerUnit: 650, roomId },
      { id: `${roomId}-w2`, name: 'Укладка плитки', unit: 'm2', quantity: waterproofingSqM, ratePerUnit: 1200, roomId },
    ],
    materials: [
      { id: `${roomId}-m1`, name: 'Керамогранит', unit: 'm2', quantity: tileQty, unitPrice: 890, roomId },
      { id: `${roomId}-m2`, name: 'Гидроизоляция Ceresit CL 51', unit: 'kg', quantity: waterproofingKg, unitPrice: 420, roomId },
    ],
  };
}

function kitchenTemplate(roomId: string, m: RoomMetrics): { works: WorkLine[]; materials: MaterialLine[] } {
  const backsplashSqM = round2(m.wallSqM * KITCHEN_BACKSPLASH_WALL_SHARE);
  const backsplashTileQty = quantityWithWaste(backsplashSqM, 'tile');

  return {
    works: [
      { id: `${roomId}-w1`, name: 'Фартук плитка', unit: 'm2', quantity: backsplashSqM, ratePerUnit: 1200, roomId },
      { id: `${roomId}-w2`, name: 'Укладка напольного покрытия', unit: 'm2', quantity: m.floorSqM, ratePerUnit: 450, roomId },
    ],
    materials: [
      { id: `${roomId}-m1`, name: 'Плитка фартук', unit: 'm2', quantity: backsplashTileQty, unitPrice: 950, roomId },
      { id: `${roomId}-m2`, name: 'Ламинат/кварц-винил', unit: 'm2', quantity: quantityWithWaste(m.floorSqM, 'default'), unitPrice: 1400, roomId },
    ],
  };
}

function capitalTemplate(roomId: string, m: RoomMetrics): { works: WorkLine[]; materials: MaterialLine[] } {
  const c = cosmeticTemplate(roomId, m);
  c.works.unshift({ id: `${roomId}-w0`, name: 'Демонтаж покрытий', unit: 'm2', quantity: m.wallSqM + m.floorSqM, ratePerUnit: 120, roomId });
  c.works.push({ id: `${roomId}-w4`, name: 'Штукатурка стен', unit: 'm2', quantity: m.wallSqM, ratePerUnit: 420, roomId });
  c.materials.push({ id: `${roomId}-m3`, name: 'Штукатурная смесь', unit: 'kg', quantity: round2(m.wallSqM * 8), unitPrice: 18, roomId });
  return c;
}

function engineeringWorkLines(roomId: string, engineering: EngineeringPoints): WorkLine[] {
  const outletsCount = validatePointCount(engineering.outletsCount);
  const plumbingPoints = validatePointCount(engineering.plumbingPoints);
  const lines: WorkLine[] = [];

  if (outletsCount > 0) {
    lines.push({
      id: `${roomId}-w-electrical`,
      name: 'Монтаж электрических точек',
      unit: 'point',
      quantity: outletsCount,
      ratePerUnit: ELECTRICAL_POINT_RATE,
      roomId,
    });
  }

  if (plumbingPoints > 0) {
    lines.push({
      id: `${roomId}-w-plumbing`,
      name: 'Монтаж сантехнических точек',
      unit: 'point',
      quantity: plumbingPoints,
      ratePerUnit: PLUMBING_POINT_RATE,
      roomId,
    });
  }

  return lines;
}

function validatePointCount(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new RangeError('Engineering point count must be a finite non-negative integer');
  }
  return value;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
