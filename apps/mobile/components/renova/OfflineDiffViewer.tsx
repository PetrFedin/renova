import { View, Text, StyleSheet } from 'react-native';
import { fieldDiff } from '@/lib/fieldDiff';

export function OfflineDiffViewer({ local, server }: { local: string; server?: string }) {
  return (
    <View style={s.box}>
      <Text style={s.head}>Трёхстороннее слияние</Text>
      <Text style={s.lbl}>Локально (очередь)</Text>
      {fieldDiff(local, server).map(d => <Text key={d.field} style={s.diffLine}>{d.field}: {d.local} → {d.server}</Text>)}
      <Text style={s.code}>{local}</Text>
      <Text style={s.lbl}>Сервер</Text>
      <Text style={s.code}>{server || '— загрузите после синхронизации —'}</Text>
    </View>
  );
}
const s = StyleSheet.create({
  box:{ backgroundColor:'#fffbeb', padding:10, borderRadius:8, marginTop:8 },
  head:{ fontWeight:'700', marginBottom:6 }, lbl:{ fontSize:11, color:'#92400e', marginTop:4 },
  code:{ fontSize:10, fontFamily:'monospace', backgroundColor:'#fff', padding:6, borderRadius:4 },
  diffLine:{ fontSize:10, color:'#b45309', marginVertical:2 },
});
