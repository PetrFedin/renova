import { View, Text, StyleSheet } from 'react-native';
import { formatRub, RenovaTheme } from '@/constants/Theme';

export function PlanFactObjects({ items }: { items: { name: string; planned: number; spent: number }[] }) {
  return (
    <View style={s.box}>
      <Text style={s.head}>План / факт по объектам</Text>
      {items.map(i => (
        <View key={i.name} style={s.row}>
          <Text style={s.n} numberOfLines={1}>{i.name}</Text>
          <Text style={s.v}>{formatRub(i.planned)} → {formatRub(i.spent)}</Text>
        </View>
      ))}
    </View>
  );
}
const s = StyleSheet.create({
  box:{ backgroundColor:'#fff', borderRadius:12, padding:12, marginBottom:12 },
  head:{ fontWeight:'800', marginBottom:8 },
  row:{ flexDirection:'row', justifyContent:'space-between', paddingVertical:5, borderTopWidth:1, borderTopColor:'#f0f0f0' },
  n:{ flex:1, fontWeight:'600', fontSize:13 }, v:{ fontSize:12, color: RenovaTheme.colors.textMuted },
});
