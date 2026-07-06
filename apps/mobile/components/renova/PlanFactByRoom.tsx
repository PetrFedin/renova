import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { EstimateLine, Room } from '@/lib/api';

export function PlanFactByRoom({ rooms, lines }: { rooms: Room[]; lines: EstimateLine[] }) {
  if (!rooms.length) return null;
  return (
    <View style={s.box}>
      <Text style={s.head}>План / факт по комнатам</Text>
      {rooms.map((r) => {
        const rl = lines.filter(l => (l.room_id && l.room_id === r.id) || l.room_name === r.name);
        const plan = rl.reduce((a,l)=>a+l.quantity_planned*l.unit_price,0);
        const fact = rl.reduce((a,l)=>a+l.quantity_actual*l.unit_price,0);
        return (
          <View key={r.id} style={s.row}>
            <Text style={s.name}>{r.name}</Text>
            <Text style={s.val}>{formatRub(plan)} → {formatRub(fact)}</Text>
          </View>
        );
      })}
    </View>
  );
}
const s = StyleSheet.create({
  box: { backgroundColor:RenovaTheme.colors.surface, borderRadius:12, padding:14, marginBottom:12 },
  head: { fontWeight:'800', marginBottom:8 },
  row: { flexDirection:'row', justifyContent:'space-between', paddingVertical:6, borderTopWidth:1, borderTopColor:'#f0f0f0' },
  name: { fontWeight:'600' },
  val: { fontSize:12, color: RenovaTheme.colors.textMuted },
});
