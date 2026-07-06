/** Прогресс ремонта по комнатам — % завершённых этапов */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { usePathname } from 'expo-router';
import { RenovaTheme, card } from '@/constants/Theme';
import { roomTypeLabel } from '@/constants/roomTypes';
import type { Room, Stage } from '@/lib/api';
import { pushRoomDetail } from '@/lib/navigation';

function roomProgress(roomId: string, stages: Stage[]) {
  const linked = stages.filter((st) => st.room_ids?.includes(roomId));
  if (!linked.length) return null;
  const done = linked.filter((st) => st.status === 'done').length;
  return Math.round((done / linked.length) * 100);
}

export function RoomProgressOverview({ rooms, stages }: { rooms: Room[]; stages: Stage[] }) {
  const pathname = usePathname();
  const items = rooms
    .map((r) => ({ room: r, pct: roomProgress(r.id, stages) }))
    .filter((x) => x.pct !== null) as { room: Room; pct: number }[];
  if (!items.length) return null;
  return (
    <View style={s.box}>
      <Text style={s.head}>Прогресс по комнатам</Text>
      {items.sort((a, b) => (a.room.floor_level ?? 1) - (b.room.floor_level ?? 1)).map(({ room, pct }) => (
        <Pressable key={room.id} style={s.row} onPress={() => pushRoomDetail(room.id, pathname)}>
          <View style={{ flex: 1 }}>
            <Text style={s.name}>{room.name}{(room.floor_level ?? 1) > 1 ? ` · ${room.floor_level} эт.` : ''}</Text>
            <Text style={s.type}>{roomTypeLabel(room.room_type)}</Text>
          </View>
          <View style={s.barWrap}><View style={[s.bar, { width: `${pct}%` }]} /></View>
          <Text style={s.pct}>{pct}%</Text>
        </Pressable>
      ))}
    </View>
  );
}
const s = StyleSheet.create({
  box: { ...card, marginBottom: 10, paddingVertical: 12 },
  head: { fontWeight: '800', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  name: { fontWeight: '700', fontSize: 13 },
  type: { fontSize: 10, color: RenovaTheme.colors.textMuted },
  barWrap: { width: 56, height: 6, backgroundColor: '#eee', borderRadius: 3, overflow: 'hidden' },
  bar: { height: 6, backgroundColor: RenovaTheme.colors.primary, borderRadius: 3 },
  pct: { fontWeight: '700', fontSize: 12, width: 36, textAlign: 'right' },
});
