/** Материалы сметы — свёрнуто по комнатам */
import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { RenovaTheme, card, formatRub } from '@/constants/Theme';
import { EstimateLineRow } from '@/components/screens/object/ObjectSection';
import type { EstimateLine } from '@/lib/api';
import { groupEstimateLinesByRoom } from '@/lib/domain/groupEstimateByRoom';
import { estimateLineSourceLabel } from '@/lib/domain/estimateFilters';

function materialMeta(l: EstimateLine): string {
  const fact = l.quantity_actual || l.quantity_planned;
  const overrun = l.quantity_planned ? ((fact - l.quantity_planned) / l.quantity_planned) * 100 : 0;
  return `план ${l.quantity_planned} → факт ${fact} ${l.unit}${overrun > 5 ? ` · +${overrun.toFixed(0)}%` : ''}`;
}

export function EstimateMaterialsByRoom({ lines }: { lines: EstimateLine[] }) {
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
                meta={materialMeta(l)}
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
