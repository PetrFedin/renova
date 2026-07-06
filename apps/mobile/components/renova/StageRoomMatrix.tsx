/** Матрица этап ↔ комната — только выбранные связи, ячейки редактируемые */
import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { usePathname } from 'expo-router';
import { RenovaTheme, card } from '@/constants/Theme';
import { roomTypeLabel } from '@/constants/roomTypes';
import { repairTabRoute } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import type { Room, Stage } from '@/lib/api';
import { filterStageRoomMatrix, toggleStageRoomLink } from '@/lib/domain/stageRoomMatrix';
import { pushRoomDetail, pushStageDetail } from '@/lib/navigation';

type Props = {
  rooms: Room[];
  stages: Stage[];
  canEdit?: boolean;
  onToggleLink?: (stageId: string, roomIds: string[]) => Promise<void>;
};

export function StageRoomMatrix({ rooms, stages, canEdit, onToggleLink }: Props) {
  const pathname = usePathname();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const { rooms: matrixRooms, stages: matrixStages } = useMemo(
    () => filterStageRoomMatrix(rooms, stages),
    [rooms, stages],
  );

  if (!matrixRooms.length || !matrixStages.length) {
    return (
      <View style={s.box}>
        <Text style={s.head}>Этапы × комнаты</Text>
        <Text style={s.empty}>Пока нет привязок этапов к комнатам.</Text>
        <Pressable onPress={() => pushOsNav(repairTabRoute('contractor', 'works'), pathname)}>
          <Text style={s.link}>→ Настроить в «Ремонт»</Text>
        </Pressable>
      </View>
    );
  }

  async function onCellPress(stage: Stage, room: Room, linked: boolean) {
    if (canEdit && onToggleLink) {
      const key = `${stage.id}:${room.id}`;
      setBusyKey(key);
      try {
        await onToggleLink(stage.id, toggleStageRoomLink(stage, room.id));
      } finally {
        setBusyKey(null);
      }
      return;
    }
    if (linked) pushStageDetail(stage.id, pathname);
  }

  return (
    <View style={s.box}>
      <Text style={s.head}>Этапы × комнаты</Text>
      <Text style={s.hint}>
        {canEdit
          ? 'Нажмите ячейку — включить или выключить комнату в этапе. Заголовок этапа — карточка этапа.'
          : 'Только выбранные этапы и комнаты.'}
      </Text>
      <View style={s.header}>
        <View style={s.corner} />
        {matrixStages.map((st) => (
          <Pressable key={st.id} style={s.colHead} onPress={() => pushStageDetail(st.id, pathname)}>
            <Text style={s.colH} numberOfLines={2}>{st.name}</Text>
          </Pressable>
        ))}
      </View>
      {matrixRooms.map((room) => (
        <View key={room.id} style={s.row}>
          <Pressable style={s.roomCell} onPress={() => pushRoomDetail(room.id, pathname)}>
            <Text style={s.roomN} numberOfLines={1}>{room.name}</Text>
            <Text style={s.roomT}>{roomTypeLabel(room.room_type)}</Text>
          </Pressable>
          {matrixStages.map((st) => {
            const linked = st.room_ids?.includes(room.id);
            const key = `${st.id}:${room.id}`;
            const busy = busyKey === key;
            return (
              <Pressable
                key={st.id}
                style={[s.cell, linked && s.on, canEdit && s.editable]}
                onPress={() => onCellPress(st, room, !!linked)}
                disabled={busy}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={RenovaTheme.colors.primary} />
                ) : (
                  <Text style={[s.dot, linked && s.dotOn]}>{linked ? '●' : '○'}</Text>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  box: { ...card, marginBottom: 12, paddingVertical: 12 },
  head: { fontWeight: '800', marginBottom: 4 },
  hint: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 10, lineHeight: 16 },
  empty: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginBottom: 8, lineHeight: 18 },
  link: { fontSize: 13, fontWeight: '700', color: RenovaTheme.colors.primary },
  header: { flexDirection: 'row', marginBottom: 4 },
  corner: { width: 88 },
  colHead: { flex: 1, paddingHorizontal: 2 },
  colH: { fontSize: 9, fontWeight: '700', textAlign: 'center', color: RenovaTheme.colors.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#f0f0f0', paddingVertical: 6 },
  roomCell: { width: 88, paddingRight: 4 },
  roomN: { fontSize: 11, fontWeight: '700' },
  roomT: { fontSize: 8, color: RenovaTheme.colors.textMuted },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 6, minHeight: 32 },
  editable: { borderRadius: 6 },
  on: { backgroundColor: RenovaTheme.colors.infoBg },
  dot: { fontSize: 14, color: '#ccc' },
  dotOn: { color: RenovaTheme.colors.primary },
});
