import type { RoomDimensions, RoomMetrics } from './types';

/** Расчёт габаритов комнаты — основа всех смет */
export function calcRoomMetrics(dim: RoomDimensions): RoomMetrics {
  const { lengthM, widthM, heightM, openingsSqM = 0 } = dim;
  const floorSqM = round2(lengthM * widthM);
  const perimeterM = round2(2 * (lengthM + widthM));
  const wallGross = perimeterM * heightM;
  const wallSqM = round2(Math.max(0, wallGross - openingsSqM));
  const volumeCuM = round2(floorSqM * heightM);
  return { floorSqM, wallSqM, perimeterM, volumeCuM };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
