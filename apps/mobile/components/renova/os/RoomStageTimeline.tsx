/** §4.18 Vertical timeline этапов на экране комнаты */
import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { usePathname } from 'expo-router';
import { RenovaTheme, card, formatRub } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import type { RoomStageCard } from '@/lib/api';
import { pushStageDetail } from '@/lib/navigation';
import { pushOsNav } from '@/lib/pushOsNav';

const ST_COLOR: Record<string, string> = {
  completed: '#22c55e', waiting_acceptance: '#f59e0b', in_progress: RenovaTheme.colors.accent,
  waiting_materials: '#94a3b8', not_started: '#cbd5e1', preparation: '#60a5fa', paused: '#a78bfa',
};

export function RoomStageTimeline({ stages }: { stages: RoomStageCard[] }) {
  const pathname = usePathname();
  const sorted = useMemo(() => [...stages].sort((a, b) => a.sort_order - b.sort_order), [stages]);
  const currentId = sorted.find((s) => s.is_current)?.id ?? sorted.find((s) => s.display_status === 'waiting_acceptance')?.id;
  const [expanded, setExpanded] = useState<string | null>(currentId ?? null);

  if (!sorted.length) return null;

  return (
    <View style={s.wrap}>
      <Text style={s.head}>Этапы ремонта</Text>
      {sorted.map((st, idx) => {
        const isOpen = expanded === st.id || st.is_current;
        const muted = st.is_future && !st.is_current;
        const done = st.is_done;
        const dotColor = ST_COLOR[st.display_status] || '#ccc';
        return (
          <View key={st.id} style={[s.row, muted && s.muted]}>
            <View style={s.rail}>
              <View style={[s.dot, { backgroundColor: dotColor }, done && s.dotDone]} />
              {idx < sorted.length - 1 && <View style={[s.line, done && s.lineDone]} />}
            </View>
            <Pressable style={[s.card, isOpen && s.cardOpen, done && !isOpen && s.cardCollapsed]} onPress={() => setExpanded(isOpen && !st.is_current ? null : st.id)}>
              <View style={s.cardTop}>
                <Text style={[s.name, muted && s.nameMuted]} numberOfLines={1}>{st.name}</Text>
                <Text style={s.st}>{st.display_status_label}</Text>
              </View>
              {isOpen ? (
                <>
                  <Text style={s.meta}>{st.works_done}/{st.works_total} работ · {st.percent_complete}%{st.overdue_days ? ` · +${st.overdue_days} дн.` : ''}</Text>
                  <View style={s.bar}><View style={[s.fill, { width: `${Math.min(100, st.percent_complete)}%` }]} /></View>
                  {st.planned_start && st.planned_end && <Text style={s.dates}>{st.planned_start.slice(0, 10)} → {st.planned_end.slice(0, 10)}</Text>}
                  <View style={s.actions}>
                    <PrimaryButton title={st.next_action.button} compact variant={st.is_current ? 'primary' : 'outline'} onPress={() => pushOsNav(st.next_action.href, pathname)} />
                    <Pressable onPress={() => pushStageDetail(st.id, pathname)}><Text style={s.link}>Подробнее ›</Text></Pressable>
                  </View>
                </>
              ) : (
                <Text style={s.collapsedMeta}>{st.percent_complete}% · {st.works_done}/{st.works_total}</Text>
              )}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 12 },
  head: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.textMuted, textTransform: 'uppercase', marginBottom: 8 },
  row: { flexDirection: 'row', gap: 10, marginBottom: 4 },
  muted: { opacity: 0.55 },
  rail: { width: 16, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 14 },
  dotDone: { backgroundColor: '#22c55e' },
  line: { flex: 1, width: 2, backgroundColor: RenovaTheme.colors.border, marginTop: 2, minHeight: 20 },
  lineDone: { backgroundColor: '#bbf7d0' },
  card: { ...card, flex: 1, marginBottom: 6, padding: 12 },
  cardOpen: { borderColor: RenovaTheme.colors.accent },
  cardCollapsed: { paddingVertical: 10 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  name: { fontSize: 14, fontWeight: '700', flex: 1, color: RenovaTheme.colors.text },
  nameMuted: { color: RenovaTheme.colors.textMuted },
  st: { fontSize: 10, fontWeight: '600', color: RenovaTheme.colors.textMuted },
  meta: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 6 },
  collapsedMeta: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 4 },
  bar: { height: 3, backgroundColor: RenovaTheme.colors.border, borderRadius: 2, marginVertical: 8, overflow: 'hidden' },
  fill: { height: 3, backgroundColor: RenovaTheme.colors.accent },
  dates: { fontSize: 11, color: RenovaTheme.colors.textMuted },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, gap: 8 },
  link: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.accent },
});
