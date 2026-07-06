/** Матрица этап × комната — только выбранные связи */
import type { Room, Stage } from '@/lib/api';

/** Этапы с room_ids и комнаты, хотя бы раз привязанные к этапу */
export function filterStageRoomMatrix(rooms: Room[], stages: Stage[]) {
  const stageIds = new Set<string>();
  const roomIds = new Set<string>();

  for (const stage of stages) {
    const ids = stage.room_ids?.filter(Boolean) ?? [];
    if (!ids.length) continue;
    stageIds.add(stage.id);
    ids.forEach((id) => roomIds.add(id));
  }

  return {
    stages: stages.filter((s) => stageIds.has(s.id)),
    rooms: rooms.filter((r) => roomIds.has(r.id)),
  };
}

/** Переключить привязку комнаты к этапу */
export function toggleStageRoomLink(stage: Stage, roomId: string): string[] {
  const current = stage.room_ids?.filter(Boolean) ?? [];
  return current.includes(roomId) ? current.filter((id) => id !== roomId) : [...current, roomId];
}

/** Список комнат по фильтру архива (на случай если API не фильтрует query) */
export function filterRoomsByArchive(rooms: Room[], archived: boolean) {
  return rooms.filter((r) => Boolean(r.is_archived) === archived);
}
