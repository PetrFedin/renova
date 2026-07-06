import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';

type Log = { field: string; old: string; new: string; at: string };
export function RoomDiffTimeline({ logs }: { logs: Log[] }) {
  if (!logs.length) return null;
  return (
    <View style={s.box}>
      <Text style={s.head}>Хронология изменений</Text>
      {logs.map((l, i) => (
        <View key={i} style={s.row}>
          <Text style={s.date}>{l.at.slice(0, 16).replace('T', ' ')}</Text>
          <Text style={s.change}>{l.field}: <Text style={s.old}>{l.old}</Text> → <Text style={s.new}>{l.new}</Text></Text>
        </View>
      ))}
    </View>
  );
}
const s = StyleSheet.create({
  box:{ backgroundColor:RenovaTheme.colors.surface, borderRadius:10, padding:12, marginBottom:10 },
  head:{ fontWeight:'800', marginBottom:8 }, row:{ paddingVertical:6, borderTopWidth:1, borderTopColor:RenovaTheme.colors.surfaceMuted },
  date:{ fontSize:10, color: RenovaTheme.colors.textMuted }, change:{ fontSize:13, marginTop:2 },
  old:{ color:'#9ca3af', textDecorationLine:'line-through' }, new:{ color:'#059669', fontWeight:'600' },
});
