/** Редактор сметы — группы по комнатам, только отфильтрованные строки */
import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import type { EstimateLine } from '@/lib/api';
import { groupEstimateLinesByRoom } from '@/lib/domain/groupEstimateByRoom';
import { EstimateLineEditorCard } from '@/components/renova/estimate/EstimateLineEditorCard';

type Props = {
  lines: EstimateLine[];
  canWrite: boolean;
  onPatch: (lineId: string, body: object) => Promise<void>;
};

export function EstimateEditorByRoom({ lines, canWrite, onPatch }: Props) {
  const groups = useMemo(() => groupEstimateLinesByRoom(lines), [lines]);
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    groups.forEach((g, i) => { init[g.roomKey] = groups.length <= 2 || i === 0; });
    return init;
  });

  if (!lines.length) {
    return <Text style={s.empty}>Нет строк по выбранным фильтрам.</Text>;
  }

  return (
    <View style={s.wrap}>
      {groups.map((g) => {
        const expanded = open[g.roomKey] ?? false;
        return (
          <View key={g.roomKey} style={s.group}>
            <Pressable style={s.head} onPress={() => setOpen((prev) => ({ ...prev, [g.roomKey]: !expanded }))}>
              <Text style={s.room}>{g.roomLabel}</Text>
              <Text style={s.summary}>{g.lines.length} поз. · {formatRub(g.plannedTotal)}</Text>
              <Text style={s.chevron}>{expanded ? '▾' : '▸'}</Text>
            </Pressable>
            {expanded && g.lines.map((line) => (
              <View key={line.id} style={s.lineWrap}>
                <EstimateLineEditorCard line={line} canWrite={canWrite} onPatch={onPatch} />
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 8 },
  empty: { fontSize: 13, color: RenovaTheme.colors.textMuted, fontStyle: 'italic', marginBottom: 8 },
  group: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    overflow: 'hidden',
    backgroundColor: RenovaTheme.colors.surface,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    backgroundColor: '#F8FAFC',
  },
  room: { flex: 1, fontWeight: '700', fontSize: 14 },
  summary: { fontSize: 11, color: RenovaTheme.colors.textMuted },
  chevron: { fontSize: 12, color: RenovaTheme.colors.primary, fontWeight: '700', width: 14, textAlign: 'right' },
  lineWrap: { paddingHorizontal: 8, paddingBottom: 4 },
});
