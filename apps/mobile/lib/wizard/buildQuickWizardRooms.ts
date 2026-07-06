/** Шаблон комнат для быстрого wizard — масштабируется по общей площади */
import type { WizardRoomDraft } from '@/constants/roomTypes';

type PropertyType = 'apartment' | 'house';

const APARTMENT_BASE: WizardRoomDraft[] = [
  { name: 'Прихожая', room_type: 'hallway', floor_level: 1, length_m: 4, width_m: 1.5, height_m: 2.7, outlets_count: 2, switches_count: 2, plumbing_points: 0 },
  { name: 'Гостиная', room_type: 'living', floor_level: 1, length_m: 4.2, width_m: 3.1, height_m: 2.7, outlets_count: 6, switches_count: 2, plumbing_points: 0 },
  { name: 'Кухня', room_type: 'kitchen', floor_level: 1, length_m: 3.2, width_m: 2.8, height_m: 2.7, outlets_count: 8, switches_count: 2, plumbing_points: 2 },
  { name: 'Санузел', room_type: 'bathroom', floor_level: 1, length_m: 2.2, width_m: 1.8, height_m: 2.7, outlets_count: 2, switches_count: 1, plumbing_points: 4 },
  { name: 'Спальня', room_type: 'bedroom', floor_level: 1, length_m: 3.5, width_m: 3, height_m: 2.7, outlets_count: 4, switches_count: 2, plumbing_points: 0 },
];

const HOUSE_BASE: WizardRoomDraft[] = [
  ...APARTMENT_BASE,
  { name: 'Кабинет', room_type: 'office', floor_level: 1, length_m: 3, width_m: 2.5, height_m: 2.7, outlets_count: 4, switches_count: 2, plumbing_points: 0 },
  { name: 'Кладовая', room_type: 'utility', floor_level: 1, length_m: 2, width_m: 1.5, height_m: 2.7, outlets_count: 1, switches_count: 1, plumbing_points: 0 },
];

function floorArea(rooms: WizardRoomDraft[]): number {
  return rooms.reduce((sum, r) => sum + r.length_m * r.width_m, 0);
}

function scaleRoom(room: WizardRoomDraft, factor: number): WizardRoomDraft {
  const scaleDim = (v: number) => Math.round(v * factor * 10) / 10;
  return {
    ...room,
    length_m: scaleDim(room.length_m),
    width_m: scaleDim(room.width_m),
    outlets_count: Math.max(1, Math.round((room.outlets_count ?? 0) * factor)),
    switches_count: Math.max(1, Math.round((room.switches_count ?? 0) * factor)),
    plumbing_points: Math.round((room.plumbing_points ?? 0) * factor),
  };
}

/** Комнаты-шаблон по типу объекта и целевой площади (м²) */
export function buildQuickWizardRooms(propertyType: PropertyType, totalSqM: number): WizardRoomDraft[] {
  const base = propertyType === 'house' ? HOUSE_BASE : APARTMENT_BASE;
  const baseArea = floorArea(base);
  const target = totalSqM > 0 ? totalSqM : baseArea;
  const factor = Math.sqrt(Math.max(0.5, target / baseArea));
  return base.map((room) => scaleRoom(room, factor));
}

export function quickWizardFloorSqM(rooms: WizardRoomDraft[]): number {
  return Math.round(floorArea(rooms) * 10) / 10;
}
