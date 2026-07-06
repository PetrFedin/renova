import { View, Text, StyleSheet } from 'react-native';

export function RoomDiffVisual({ before, after }: { before: Record<string, string | number>; after: Record<string, string | number> }) {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const changed = keys.filter(k => String(before[k]) !== String(after[k]));
  if (!changed.length) return null;
  return (
    <View style={s.box}>
      <Text style={s.head}>Сравнение до / после</Text>
      {changed.map(k => (
        <View key={k} style={s.row}>
          <Text style={s.k}>{k}</Text>
          <Text style={s.old}>{before[k] ?? '—'}</Text>
          <Text>→</Text>
          <Text style={s.new}>{after[k] ?? '—'}</Text>
        </View>
      ))}
    </View>
  );
}
const s = StyleSheet.create({
  box:{ backgroundColor:'#fff', borderRadius:10, padding:12, marginBottom:10, borderWidth:1, borderColor:'#e5e7eb' },
  head:{ fontWeight:'800', marginBottom:8 },
  row:{ flexDirection:'row', alignItems:'center', gap:6, paddingVertical:4, flexWrap:'wrap' },
  k:{ fontWeight:'600', width:90, fontSize:12 }, old:{ color:'#9ca3af', fontSize:12 }, new:{ color:'#059669', fontWeight:'700', fontSize:12 },
});
