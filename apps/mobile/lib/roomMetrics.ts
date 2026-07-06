/** Обёртка над calc-engine — единый источник расчёта метрик комнаты */
import { calcRoomMetrics as calcEngineMetrics } from '@/lib/calc-engine';

export function calcRoomMetrics(length_m: number, width_m: number, height_m: number, openings_sq_m = 2) {
  const m = calcEngineMetrics({
    lengthM: length_m,
    widthM: width_m,
    heightM: height_m,
    openingsSqM: openings_sq_m,
  });
  return {
    floor_sq_m: m.floorSqM,
    wall_sq_m: m.wallSqM,
    perimeter_m: m.perimeterM,
    volume_cu_m: m.volumeCuM,
  };
}
