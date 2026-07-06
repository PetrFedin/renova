/** Этапы, затрагивающие комнату */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { usePathname } from 'expo-router';
import { RenovaTheme, card } from '@/constants/Theme';
import type { Room, Stage } from '@/lib/api';
import { STAGE_STATUS_ICON } from '@/constants/labels';
import { pushStageDetail } from '@/lib/navigation';

export function RoomStagesPanel({ room, stages }: { room: Room; stages: Stage[] }) {
  const pathname = usePathname();
  const linked = stages.filter((s) => s.room_ids?.includes(room.id));
  if (!linked.length) return null;
  return (
    <View style={s.box}>
      <Text style={s.head}>Этапы в этой комнате</Text>
      {linked.map((st) => (
        <Pressable key={st.id} style={s.row} onPress={() => pushStageDetail(st.id, pathname)}>
          <Text style={s.icon}>{STAGE_STATUS_ICON[st.status] || '·'}</Text>
          <Text style={s.name}>{st.name}</Text>
          <Text style={s.chev}>›</Text>
        </Pressable>
      ))}
    </View>
  );
}
const s = StyleSheet.create({
  box: { ...card, marginBottom: 12, paddingVertical: 12 },
  head: { fontWeight: '800', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  icon: { width: 24 },
  name: { flex: 1, fontWeight: '600', fontSize: 13 },
  chev: { color: '#999' },
});
