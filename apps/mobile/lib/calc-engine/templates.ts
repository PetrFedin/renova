import type { RenovationType, RoomMetrics, WorkLine, MaterialLine } from './types';
import { quantityWithWaste } from './estimate';

/** Шаблоны работ MVP — генерируют строки сметы из метрик комнаты */
export function generateTemplateLines(
  type: RenovationType,
  roomId: string,
  metrics: RoomMetrics,
): { works: WorkLine[]; materials: MaterialLine[] } {
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
}

function cosmeticTemplate(roomId: string, m: RoomMetrics): { works: WorkLine[]; materials: MaterialLine[] } {
  const paintQty = quantityWithWaste(m.wallSqM, 'paint');
  return {
    works: [
      { id: `${roomId}-w1`, name: 'Подготовка стен', unit: 'm2', quantity: m.wallSqM, ratePerUnit: 180, roomId },
      { id: `${roomId}-w2`, name: 'Покраска стен 2 слоя', unit: 'm2', quantity: m.wallSqM, ratePerUnit: 320, roomId },
      { id: `${roomId}-w3`, name: 'Укладка ламината', unit: 'm2', quantity: m.floorSqM, ratePerUnit: 450, roomId },
    ],
    materials: [
      { id: `${roomId}-m1`, name: 'Краска интерьерная', unit: 'l', quantity: round2(paintQty / 8), unitPrice: 890, roomId },
      { id: `${roomId}-m2`, name: 'Ламинат', unit: 'm2', quantity: quantityWithWaste(m.floorSqM, 'default'), unitPrice: 1200, roomId },
    ],
  };
}

function bathroomTemplate(roomId: string, m: RoomMetrics): { works: WorkLine[]; materials: MaterialLine[] } {
  const tileQty = quantityWithWaste(m.wallSqM + m.floorSqM, 'tile');
  return {
    works: [
      { id: `${roomId}-w1`, name: 'Гидроизоляция', unit: 'm2', quantity: m.floorSqM + m.wallSqM, ratePerUnit: 650, roomId },
      { id: `${roomId}-w2`, name: 'Укладка плитки', unit: 'm2', quantity: m.wallSqM + m.floorSqM, ratePerUnit: 1200, roomId },
    ],
    materials: [
      { id: `${roomId}-m1`, name: 'Керамогранит', unit: 'm2', quantity: tileQty, unitPrice: 890, roomId },
      { id: `${roomId}-m2`, name: 'Гидроизоляция Ceresit', unit: 'kg', quantity: round2(m.floorSqM * 2), unitPrice: 420, roomId },
    ],
  };
}

function kitchenTemplate(roomId: string, m: RoomMetrics): { works: WorkLine[]; materials: MaterialLine[] } {
  const tileQty = quantityWithWaste(m.wallSqM * 0.4 + m.floorSqM, 'tile');
  return {
    works: [
      { id: `${roomId}-w1`, name: 'Фартук плитка', unit: 'm2', quantity: round2(m.wallSqM * 0.4), ratePerUnit: 1200, roomId },
      { id: `${roomId}-w2`, name: 'Укладка напольного покрытия', unit: 'm2', quantity: m.floorSqM, ratePerUnit: 450, roomId },
      { id: `${roomId}-w3`, name: 'Электромонтаж кухни', unit: 'точка', quantity: 8, ratePerUnit: 850, roomId },
    ],
    materials: [
      { id: `${roomId}-m1`, name: 'Плитка фартук', unit: 'm2', quantity: tileQty, unitPrice: 950, roomId },
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


function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
