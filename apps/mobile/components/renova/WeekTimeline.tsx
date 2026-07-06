import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { Stage } from '@/lib/api';

export function WeekTimeline({ stages }: { stages: Stage[] }) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
  return (
    <View style={s.box}>
      <Text style={s.head}>Неделя</Text>
      <View style={s.row}>{days.map(d => {
        const n = stages.filter(st => st.planned_end === d || st.planned_start === d).length;
        return (<View key={d} style={s.cell}><Text style={s.d}>{d.slice(5)}</Text><Text style={s.n}>{n || '·'}</Text></View>);
      })}</View>
    </View>
  );
}
const s = StyleSheet.create({
  box:{ backgroundColor:'#fff', borderRadius:12, padding:12, marginBottom:10 },
  head:{ fontWeight:'800', marginBottom:8 },
  row:{ flexDirection:'row', justifyContent:'space-between' },
  cell:{ alignItems:'center', flex:1 }, d:{ fontSize:10, color: RenovaTheme.colors.textMuted }, n:{ fontWeight:'700', marginTop:4 },
});
