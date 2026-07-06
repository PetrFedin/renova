import AsyncStorage from '@react-native-async-storage/async-storage';
import { Room } from '@/lib/api';
export async function snapshotRoom(room: Room) {
  await AsyncStorage.setItem(`renova_room_snap_${room.id}`, JSON.stringify(room));
}
export async function getRoomDiff(room: Room): Promise<string[]> {
  const raw = await AsyncStorage.getItem(`renova_room_snap_${room.id}`);
  if (!raw) return [];
  const prev: Room = JSON.parse(raw);
  const changes: string[] = [];
  const fields: (keyof Room)[] = ['length_m','width_m','height_m','outlets_count','plumbing_points','switches_count'];
  for (const f of fields) {
    if (prev[f] !== room[f]) changes.push(`${f}: ${prev[f]} → ${room[f]}`);
  }
  return changes;
}
