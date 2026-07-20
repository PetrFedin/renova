/** Смета этапа — только выбранные комнаты */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { pushOsNav } from '@/lib/pushOsNav';
import { EstimateLine, Room } from '@/lib/api';
import { filterLinesForStage, sumEstimateLines } from '@/lib/stageEstimate';
import { formatRub, RenovaTheme } from '@/constants/Theme';
import type { OsRole } from '@/constants/osSections';

export function StageEstimatePanel({
  lines,
  rooms,
  roomIds,
  estimateHref,
  role = 'customer',
  returnTo,
}: {
  lines: EstimateLine[];
  rooms: Room[];
  roomIds?: string[] | null;
  estimateHref: string;
  /** W114: канон deep-link в смету объекта */
  role?: OsRole;
  returnTo?: string;
}) {
  const scoped = filterLinesForStage(lines, roomIds);
  const total = sumEstimateLines(scoped);
  const linked = roomIds?.length
    ? rooms.filter((r) => roomIds.includes(r.id))
    : rooms;

  if (!scoped.length && !roomIds?.length) return null;

  return (
    <View style={s.box}>
      <Text style={s.head}>Смета этапа</Text>
      {roomIds?.length ? (
        <Text style={s.hint}>Комнаты: {linked.map((r) => r.name).join(', ') || '—'}</Text>
      ) : (
        <Text style={s.hint}>Весь объект · {scoped.length || lines.length} строк</Text>
      )}
      <Text style={s.total}>{formatRub(total || sumEstimateLines(lines))}</Text>
      {(scoped.length ? scoped : lines).slice(0, 5).map((l) => (
        <Text key={l.id} style={s.line}>· {l.name} — {formatRub(l.quantity_planned * l.unit_price)}</Text>
      ))}
      {(scoped.length || lines.length) > 5 && <Text style={s.more}>…ещё {(scoped.length || lines.length) - 5} строк</Text>}
      <Pressable onPress={() => pushOsNav(estimateHref, returnTo, role)}>
        <Text style={s.link}>Открыть смету →</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  box: { backgroundColor: RenovaTheme.colors.surface, padding: 12, borderRadius: 10, marginBottom: 10 },
  head: { fontWeight: '800', marginBottom: 4 },
  hint: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 6 },
  total: { fontSize: 22, fontWeight: '800', color: RenovaTheme.colors.primary, marginBottom: 8 },
  line: { fontSize: 12, color: '#333', paddingVertical: 2 },
  more: { fontSize: 11, color: RenovaTheme.colors.textMuted },
  link: { marginTop: 8, color: RenovaTheme.colors.primary, fontWeight: '700' },
});
