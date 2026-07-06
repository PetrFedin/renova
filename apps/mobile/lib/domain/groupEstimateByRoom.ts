/** Группировка позиций сметы по комнатам */
import type { EstimateLine } from '@/lib/api';

export type EstimateRoomGroup = {
  roomKey: string;
  roomLabel: string;
  lines: EstimateLine[];
  plannedTotal: number;
};

export function groupEstimateLinesByRoom(lines: EstimateLine[]): EstimateRoomGroup[] {
  const map = new Map<string, EstimateLine[]>();
  for (const line of lines) {
    const label = line.room_name?.trim() || 'Общее';
    const key = line.room_id || label;
    const bucket = map.get(key) || [];
    bucket.push(line);
    map.set(key, bucket);
  }
  return [...map.entries()]
    .map(([roomKey, groupLines]) => ({
      roomKey,
      roomLabel: groupLines[0]?.room_name?.trim() || 'Общее',
      lines: groupLines,
      plannedTotal: groupLines.reduce((s, l) => s + l.quantity_planned * l.unit_price, 0),
    }))
    .sort((a, b) => a.roomLabel.localeCompare(b.roomLabel, 'ru'));
}
