/** Работы сметы — свёрнуто по комнатам (аналог материалов) */
import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { RenovaTheme, card, formatRub } from '@/constants/Theme';
import { EstimateLineRow } from '@/components/screens/object/ObjectSection';
import type { EstimateLine } from '@/lib/api';
import { estimateLineSourceLabel } from '@/lib/domain/estimateFilters';
import { groupEstimateLinesByRoom } from '@/lib/domain/groupEstimateByRoom';

function workMeta(l: EstimateLine): string {
  return `${l.quantity_planned} ${l.unit} · ${formatRub(l.quantity_planned * l.unit_price)}`;
}

export function EstimateWorksByRoom({ lines }: { lines: EstimateLine[] }) {
  const groups = useMemo(() => groupEstimateLinesByRoom(lines), [lines]);
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    groups.forEach((g, i) => { init[g.roomKey] = groups.length <= 2 || i === 0; });
    return init;
  });

  if (!groups.length) return null;

  return (
    <View style={s.wrap}>
      {groups.map((g) => {
        const expanded = open[g.roomKey] ?? false;
        return (
          <View key={g.roomKey} style={s.group}>
            <Pressable
              style={s.head}
              onPress={() => setOpen((prev) => ({ ...prev, [g.roomKey]: !expanded }))}
            >
              <Text style={s.room}>{g.roomLabel}</Text>
              <Text style={s.summary} numberOfLines={1}>
                {g.lines.length} поз. · {formatRub(g.plannedTotal)}
              </Text>
              <Text style={s.chevron}>{expanded ? '▾' : '▸'}</Text>
            </Pressable>
            {expanded && g.lines.map((l) => (
              <EstimateLineRow
                key={l.id}
                name={l.name}
                badge={estimateLineSourceLabel(l)}
                detail={l.calc_detail}
                notes={l.notes}
                meta={workMeta(l)}
              />
            ))}
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 8 },
  group: { ...card, padding: 0, overflow: 'hidden' },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    backgroundColor: '#F8FAFC',
  },
  room: { fontWeight: '700', fontSize: 14, color: RenovaTheme.colors.text, flex: 1 },
  summary: { fontSize: 11, color: RenovaTheme.colors.textMuted, flexShrink: 1 },
  chevron: { fontSize: 12, color: RenovaTheme.colors.primary, fontWeight: '700', width: 14, textAlign: 'right' },
});
