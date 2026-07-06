/** Краткая сводка объекта: тип, комнаты, этажи */
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme, card } from '@/constants/Theme';
import { roomTypeLabel } from '@/constants/roomTypes';
import type { ProjectDetail } from '@/lib/api';

export function PropertySummary({ project, compact }: { project: ProjectDetail; compact?: boolean }) {
  const rooms = project.rooms || [];
  const floors = [...new Set(rooms.map((r) => r.floor_level ?? 1))].sort((a, b) => a - b);
  const types = [...new Set(rooms.map((r) => r.room_type).filter(Boolean))];
  const isHouse = project.property_type === 'house';
  const reno =
    project.renovation_type === 'cosmetic'
      ? 'Косметический'
      : project.renovation_type === 'capital'
        ? 'Капитальный'
        : project.renovation_type;

  return (
    <View style={[s.box, compact && s.compact]}>
      <Text style={s.head}>
        {isHouse ? '🏠 Дом' : '🏢 Квартира'} · {rooms.length} комн.
      </Text>
      <Text style={s.meta}>
        {isHouse && floors.length > 1 ? `${floors.length} этажа · ` : ''}
        {reno} ремонт
        {types.length
          ? ` · ${types.slice(0, 4).map((t) => roomTypeLabel(t)).join(', ')}${types.length > 4 ? '…' : ''}`
          : ''}
      </Text>
      {project.address ? <Text style={s.addr}>{project.address}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: { ...card, marginBottom: 12 },
  compact: { marginBottom: 8 },
  head: { fontWeight: '800', fontSize: 14 },
  meta: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 4, lineHeight: 16 },
  addr: { fontSize: 12, color: RenovaTheme.colors.text, marginTop: 6 },
});
