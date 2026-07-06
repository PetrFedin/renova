/** Типы помещений — единый справочник для wizard, комнат, сметы */
export type RoomTypeId =
  | 'living' | 'bedroom' | 'kitchen' | 'bathroom' | 'toilet'
  | 'hallway' | 'balcony' | 'office' | 'utility' | 'other';

export const ROOM_TYPES: { id: RoomTypeId; label: string }[] = [
  { id: 'living', label: 'Гостиная' },
  { id: 'bedroom', label: 'Спальня' },
  { id: 'kitchen', label: 'Кухня' },
  { id: 'bathroom', label: 'Ванная' },
  { id: 'toilet', label: 'Туалет' },
  { id: 'hallway', label: 'Прихожая' },
  { id: 'balcony', label: 'Балкон/лоджия' },
  { id: 'office', label: 'Кабинет' },
  { id: 'utility', label: 'Кладовая' },
  { id: 'other', label: 'Другое' },
];

export const ROOM_PRESETS = [
  { name: 'Кухня', room_type: 'kitchen' as RoomTypeId, length_m: 3.2, width_m: 2.8, height_m: 2.7, outlets_count: 8, switches_count: 2, plumbing_points: 2, floor_level: 1 },
  { name: 'Ванная', room_type: 'bathroom' as RoomTypeId, length_m: 2.2, width_m: 1.8, height_m: 2.7, outlets_count: 2, switches_count: 1, plumbing_points: 4, floor_level: 1 },
  { name: 'Туалет', room_type: 'toilet' as RoomTypeId, length_m: 1.2, width_m: 0.9, height_m: 2.7, outlets_count: 0, switches_count: 1, plumbing_points: 2, floor_level: 1 },
  { name: 'Спальня', room_type: 'bedroom' as RoomTypeId, length_m: 3.5, width_m: 3.0, height_m: 2.7, outlets_count: 4, switches_count: 2, plumbing_points: 0, floor_level: 1 },
  { name: 'Прихожая', room_type: 'hallway' as RoomTypeId, length_m: 4.0, width_m: 1.5, height_m: 2.7, outlets_count: 2, switches_count: 2, plumbing_points: 0, floor_level: 1 },
  { name: 'Гостиная', room_type: 'living' as RoomTypeId, length_m: 4.2, width_m: 3.1, height_m: 2.7, outlets_count: 6, switches_count: 2, plumbing_points: 0, floor_level: 1 },
];

export function roomTypeLabel(id: string | null | undefined): string {
  if (!id) return '—';
  return ROOM_TYPES.find((t) => t.id === id)?.label ?? id;
}

/** Тип ремонта для расчёта сметы: комната может переопределять тип проекта */
export function resolveRenovationType(projectType: string, roomType?: string | null): string {
  const map: Record<string, string> = {
    bathroom: 'bathroom', toilet: 'bathroom', kitchen: 'kitchen',
  };
  if (roomType && map[roomType]) return map[roomType];
  return projectType;
}

export type WizardRoomDraft = {
  name: string;
  room_type?: RoomTypeId | string;
  floor_level?: number;
  length_m: number;
  width_m: number;
  height_m: number;
  outlets_count?: number;
  switches_count?: number;
  plumbing_points?: number;
};
