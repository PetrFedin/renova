/** Группировка комнат по этажам (для дома) */
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import type { Room } from '@/lib/api';

export function groupRoomsByFloor(rooms: Room[], propertyType?: string) {
  const sorted = [...rooms].sort((a, b) => (a.floor_level ?? 1) - (b.floor_level ?? 1) || a.name.localeCompare(b.name));
  if (propertyType !== 'house') return [{ floor: 1, rooms: sorted }];
  const map = new Map<number, Room[]>();
  sorted.forEach((r) => {
    const f = r.floor_level ?? 1;
    if (!map.has(f)) map.set(f, []);
    map.get(f)!.push(r);
  });
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([floor, rs]) => ({ floor, rooms: rs }));
}

export function FloorSectionHeader({ floor, count, isHouse }: { floor: number; count: number; isHouse: boolean }) {
  if (!isHouse) return null;
  const label = floor === 1 ? '1 этаж' : floor === 2 ? '2 этаж' : `${floor} этаж`;
  return (
    <View style={s.head}>
      <Text style={s.title}>🏠 {label}</Text>
      <Text style={s.meta}>{count} комн.</Text>
    </View>
  );
}
const s = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, marginBottom: 6 },
  title: { fontWeight: '800', fontSize: 15 },
  meta: { fontSize: 12, color: RenovaTheme.colors.textMuted },
});
