import type { RenovationType, RoomMetrics, WorkLine, MaterialLine } from './types';
import { quantityWithWaste } from './estimate';

export interface CalcNormativeCatalog {
  paint: {
    coats: number;
    coverageSqMPerLiter: number;
    unitPrice: number;
  };
  kitchen: {
    backsplashWallShare: number;
  };
  waterproofing: {
    coats: number;
    kgPerSqMTwoCoats: number;
    unitPrice: number;
  };
  plaster: {
    kgPerSqM: number;
    unitPrice: number;
  };
  workRates: {
    wallPreparationPerSqM: number;
    wallPaintingPerSqM: number;
    laminateInstallationPerSqM: number;
    demolitionPerSqM: number;
    plasteringPerSqM: number;
    waterproofingPerSqM: number;
    tilingPerSqM: number;
    electricalPoint: number;
    plumbingPoint: number;
  };
  materialPrices: {
    laminatePerSqM: number;
    porcelainTilePerSqM: number;
    backsplashTilePerSqM: number;
    kitchenFlooringPerSqM: number;
  };
}

/**
 * Единый источник нормативов MVP.
 * Следующие версии каталога смогут загружаться из БД, иметь регион,
 * период действия и сохраняться вместе со снимком сметы.
 */
export const CALC_NORMATIVES: Readonly<CalcNormativeCatalog> = Object.freeze({
  paint: {
    coats: 2,
    coverageSqMPerLiter: 8,
    unitPrice: 890,
  },
  kitchen: {
    backsplashWallShare: 0.4,
  },
  waterproofing: {
    coats: 2,
    kgPerSqMTwoCoats: 1.4,
    unitPrice: 420,
  },
  plaster: {
    kgPerSqM: 8,
    unitPrice: 18,
  },
  workRates: {
    wallPreparationPerSqM: 180,
    wallPaintingPerSqM: 320,
    laminateInstallationPerSqM: 450,
    demolitionPerSqM: 120,
    plasteringPerSqM: 420,
    waterproofingPerSqM: 650,
    tilingPerSqM: 1200,
    electricalPoint: 850,
    plumbingPoint: 2500,
  },
  materialPrices: {
    laminatePerSqM: 1200,
    porcelainTilePerSqM: 890,
    backsplashTilePerSqM: 950,
    kitchenFlooringPerSqM: 1400,
  },
});

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
  const paintCoverageSqM = m.wallSqM * CALC_NORMATIVES.paint.coats;
  const paintLiters = quantityWithWaste(
    paintCoverageSqM / CALC_NORMATIVES.paint.coverageSqMPerLiter,
    'paint',
  );

  return {
    works: [
      {
        id: `${roomId}-w1`,
        name: 'Подготовка стен',
        unit: 'm2',
        quantity: m.wallSqM,
        ratePerUnit: CALC_NORMATIVES.workRates.wallPreparationPerSqM,
        roomId,
      },
      {
        id: `${roomId}-w2`,
        name: `Покраска стен ${CALC_NORMATIVES.paint.coats} слоя`,
        unit: 'm2',
        quantity: m.wallSqM,
        ratePerUnit: CALC_NORMATIVES.workRates.wallPaintingPerSqM,
        roomId,
      },
      {
        id: `${roomId}-w3`,
        name: 'Укладка ламината',
        unit: 'm2',
        quantity: m.floorSqM,
        ratePerUnit: CALC_NORMATIVES.workRates.laminateInstallationPerSqM,
        roomId,
      },
    ],
    materials: [
      {
        id: `${roomId}-m1`,
        name: 'Краска интерьерная',
        unit: 'l',
        quantity: round2(paintLiters),
        unitPrice: CALC_NORMATIVES.paint.unitPrice,
        roomId,
      },
      {
        id: `${roomId}-m2`,
        name: 'Ламинат',
        unit: 'm2',
        quantity: quantityWithWaste(m.floorSqM, 'default'),
        unitPrice: CALC_NORMATIVES.materialPrices.laminatePerSqM,
        roomId,
      },
    ],
  };
}

function bathroomTemplate(roomId: string, m: RoomMetrics): { works: WorkLine[]; materials: MaterialLine[] } {
  const waterproofingSqM = round2(m.wallSqM + m.floorSqM);
  const tileQty = quantityWithWaste(waterproofingSqM, 'tile');
  const waterproofingKg = round2(
    waterproofingSqM * CALC_NORMATIVES.waterproofing.kgPerSqMTwoCoats,
  );

  return {
    works: [
      {
        id: `${roomId}-w1`,
        name: `Гидроизоляция в ${CALC_NORMATIVES.waterproofing.coats} слоя`,
        unit: 'm2',
        quantity: waterproofingSqM,
        ratePerUnit: CALC_NORMATIVES.workRates.waterproofingPerSqM,
        roomId,
      },
      {
        id: `${roomId}-w2`,
        name: 'Укладка плитки',
        unit: 'm2',
        quantity: waterproofingSqM,
        ratePerUnit: CALC_NORMATIVES.workRates.tilingPerSqM,
        roomId,
      },
    ],
    materials: [
      {
        id: `${roomId}-m1`,
        name: 'Керамогранит',
        unit: 'm2',
        quantity: tileQty,
        unitPrice: CALC_NORMATIVES.materialPrices.porcelainTilePerSqM,
        roomId,
      },
      {
        id: `${roomId}-m2`,
        name: 'Гидроизоляция Ceresit CL 51',
        unit: 'kg',
        quantity: waterproofingKg,
        unitPrice: CALC_NORMATIVES.waterproofing.unitPrice,
        roomId,
      },
    ],
  };
}

function kitchenTemplate(roomId: string, m: RoomMetrics): { works: WorkLine[]; materials: MaterialLine[] } {
  const backsplashSqM = round2(m.wallSqM * CALC_NORMATIVES.kitchen.backsplashWallShare);
  const backsplashTileQty = quantityWithWaste(backsplashSqM, 'tile');

  return {
    works: [
      {
        id: `${roomId}-w1`,
        name: 'Фартук плитка',
        unit: 'm2',
        quantity: backsplashSqM,
        ratePerUnit: CALC_NORMATIVES.workRates.tilingPerSqM,
        roomId,
      },
      {
        id: `${roomId}-w2`,
        name: 'Укладка напольного покрытия',
        unit: 'm2',
        quantity: m.floorSqM,
        ratePerUnit: CALC_NORMATIVES.workRates.laminateInstallationPerSqM,
        roomId,
      },
    ],
    materials: [
      {
        id: `${roomId}-m1`,
        name: 'Плитка фартук',
        unit: 'm2',
        quantity: backsplashTileQty,
        unitPrice: CALC_NORMATIVES.materialPrices.backsplashTilePerSqM,
        roomId,
      },
      {
        id: `${roomId}-m2`,
        name: 'Ламинат/кварц-винил',
        unit: 'm2',
        quantity: quantityWithWaste(m.floorSqM, 'default'),
        unitPrice: CALC_NORMATIVES.materialPrices.kitchenFlooringPerSqM,
        roomId,
      },
    ],
  };
}

function capitalTemplate(roomId: string, m: RoomMetrics): { works: WorkLine[]; materials: MaterialLine[] } {
  const c = cosmeticTemplate(roomId, m);
  c.works.unshift({
    id: `${roomId}-w0`,
    name: 'Демонтаж покрытий',
    unit: 'm2',
    quantity: m.wallSqM + m.floorSqM,
    ratePerUnit: CALC_NORMATIVES.workRates.demolitionPerSqM,
    roomId,
  });
  c.works.push({
    id: `${roomId}-w4`,
    name: 'Штукатурка стен',
    unit: 'm2',
    quantity: m.wallSqM,
    ratePerUnit: CALC_NORMATIVES.workRates.plasteringPerSqM,
    roomId,
  });
  c.materials.push({
    id: `${roomId}-m3`,
    name: 'Штукатурная смесь',
    unit: 'kg',
    quantity: round2(m.wallSqM * CALC_NORMATIVES.plaster.kgPerSqM),
    unitPrice: CALC_NORMATIVES.plaster.unitPrice,
    roomId,
  });
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
      ratePerUnit: CALC_NORMATIVES.workRates.electricalPoint,
      roomId,
    });
  }

  if (plumbingPoints > 0) {
    lines.push({
      id: `${roomId}-w-plumbing`,
      name: 'Монтаж сантехнических точек',
      unit: 'point',
      quantity: plumbingPoints,
      ratePerUnit: CALC_NORMATIVES.workRates.plumbingPoint,
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
