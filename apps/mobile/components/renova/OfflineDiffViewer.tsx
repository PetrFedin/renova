import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { fieldDiff } from '@/lib/fieldDiff';

export function OfflineDiffViewer({ local, server }: { local: string; server?: string }) {
  return (
    <View style={s.box}>
      <Text style={s.head}>Трёхстороннее слияние</Text>
      <Text style={s.lbl}>Локально (очередь)</Text>
      {server ? fieldDiff(local, server).map(d => <Text key={d.field} style={s.diffLine}>{d.field}: {d.local} → {d.server}</Text>) : null}
      <Text style={s.code}>{local}</Text>
      <Text style={s.lbl}>Сервер</Text>
      <Text style={s.code}>{server || 'Серверная версия пока неизвестна. Нажмите «Повторить сейчас» — после синхронизации она подтянется.'}</Text>
    </View>
  );
}
const s = StyleSheet.create({
  box:{ backgroundColor:RenovaTheme.colors.warningBg, padding:10, borderRadius:8, marginTop:8 },
  head:{ fontWeight:'700', marginBottom:6 }, lbl:{ fontSize:11, color:RenovaTheme.colors.warningText, marginTop:4 },
  code:{ fontSize:10, fontFamily:'monospace', backgroundColor:RenovaTheme.colors.surface, padding:6, borderRadius:4 },
  diffLine:{ fontSize:10, color:RenovaTheme.colors.warningText, marginVertical:2 },
});
