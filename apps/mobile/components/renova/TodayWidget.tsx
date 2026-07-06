import { View, Text, Pressable, StyleSheet } from 'react-native';
import { usePathname } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import { Stage } from '@/lib/api';
import { stageStatusLabel } from '@/constants/labels';
import { pushStageDetail } from '@/lib/navigation';

export function TodayWidget({ stages, role }: { stages: Stage[]; role: 'customer' | 'contractor' }) {
  const pathname = usePathname();
  const today = new Date().toISOString().slice(0,10);
  const items = stages.filter(s => {
    if (s.status === 'review' && role === 'customer') return true;
    if (s.status === 'active' && role === 'contractor' && !s.contractor_ready) return true;
    if (s.planned_end === today) return true;
    return s.planned_end && s.planned_end < today && s.status !== 'done';
  }).slice(0,5);
  if (!items.length) return null;
  return (
    <View style={s.box}>
      <Text style={s.head}>Сегодня</Text>
      {items.map(st => (
        <Pressable key={st.id} style={s.row} onPress={() => pushStageDetail(st.id, pathname)}>
          <Text style={s.title}>{st.name}</Text>
          <Text style={s.sub}>{st.status === 'review' ? 'Приёмка' : st.planned_end === today ? 'Дедлайн' : stageStatusLabel(st.status)}</Text>
        </Pressable>
      ))}
    </View>
  );
}
const s = StyleSheet.create({
  box: { backgroundColor:'#ecfdf5', borderRadius:12, padding:12, marginBottom:12, borderWidth:1, borderColor:'#a7f3d0' },
  head: { fontWeight:'800', color:'#065f46', marginBottom:6 },
  row: { paddingVertical:6, borderTopWidth:1, borderTopColor:'#d1fae5' },
  title: { fontWeight:'700' },
  sub: { fontSize:12, color: RenovaTheme.colors.textMuted },
});
