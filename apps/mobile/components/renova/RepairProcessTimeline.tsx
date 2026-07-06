/** Хронология ремонта: этапы + статус + переход */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { usePathname } from 'expo-router';
import { RenovaTheme, formatRub, card } from '@/constants/Theme';
import type { Stage } from '@/lib/api';
import { STAGE_STATUS_ICON } from '@/constants/labels';
import { pushStageDetail } from '@/lib/navigation';

export function RepairProcessTimeline({ stages }: { stages: Stage[] }) {
  const pathname = usePathname();
  const sorted = [...stages].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  if (!sorted.length) return null;
  return (
    <View style={s.box}>
      <Text style={s.head}>Хронология работ</Text>
      {sorted.map((st, i) => (
        <Pressable key={st.id} style={s.row} onPress={() => pushStageDetail(st.id, pathname)}>
          <Text style={s.num}>{STAGE_STATUS_ICON[st.status] || '·'}</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.name}>{st.name}</Text>
            <Text style={s.meta}>{st.planned_start && st.planned_end ? `${st.planned_start} → ${st.planned_end}` : 'Даты не заданы'}{st.room_ids?.length ? ` · ${st.room_ids.length} комн.` : ''}</Text>
          </View>
          <Text style={s.pay}>{formatRub(st.payment_amount)}</Text>
        </Pressable>
      ))}
    </View>
  );
}
const s = StyleSheet.create({
  box: { ...card, marginBottom: 10, paddingVertical: 12 },
  head: { fontWeight: '800', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  num: { width: 28, fontSize: 16, textAlign: 'center' },
  name: { fontWeight: '700', fontSize: 13 },
  meta: { fontSize: 10, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  pay: { fontSize: 11, fontWeight: '600', color: RenovaTheme.colors.primary },
});
