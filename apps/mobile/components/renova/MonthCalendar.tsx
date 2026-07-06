import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { Stage } from '@/lib/api';

export function MonthCalendar({ stages }: { stages: Stage[] }) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const first = new Date(y, m, 1).getDay() || 7;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells: (number|null)[] = [...Array(first-1).fill(null), ...Array.from({length:daysInMonth},(_,i)=>i+1)];
  const mark = (d: number) => {
    const iso = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    return stages.some(s => s.planned_end === iso || s.planned_start === iso);
  };
  return (
    <View style={s.box}>
      <Text style={s.head}>{now.toLocaleString('ru', { month: 'long', year: 'numeric' })}</Text>
      <View style={s.grid}>{cells.map((d,i) => (
        <View key={i} style={[s.cell, d && mark(d) && s.marked]}><Text style={s.d}>{d || ''}</Text></View>
      ))}</View>
    </View>
  );
}
const s = StyleSheet.create({
  box:{ backgroundColor:RenovaTheme.colors.surface, borderRadius:12, padding:12, marginBottom:10 },
  head:{ fontWeight:'800', marginBottom:8, textTransform:'capitalize' },
  grid:{ flexDirection:'row', flexWrap:'wrap' },
  cell:{ width:'14.28%', aspectRatio:1, alignItems:'center', justifyContent:'center' },
  marked:{ backgroundColor:'#dbeafe', borderRadius:6 },
  d:{ fontSize:12 },
});
