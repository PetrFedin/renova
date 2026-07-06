import { View, Text, Pressable, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
const OPT = [5, 10, 15, 20];
export function RoomBudgetThreshold({ value, onChange }: { value?: number | null; onChange: (v: number) => void }) {
  const cur = value ?? 10;
  return (
    <View style={s.row}>
      <Text style={s.lbl}>Порог alert комнаты +</Text>
      {OPT.map(o => <Pressable key={o} style={[s.ch, cur===o && s.on]} onPress={() => onChange(o)}><Text style={[s.t, cur===o && s.tOn]}>{o}%</Text></Pressable>)}
    </View>
  );
}
const s = StyleSheet.create({ row:{ flexDirection:'row', flexWrap:'wrap', gap:6, marginVertical:6, alignItems:'center' }, lbl:{ fontSize:11, color:'#666' }, ch:{ paddingHorizontal:8, paddingVertical:4, borderRadius:10, backgroundColor:RenovaTheme.colors.border }, on:{ backgroundColor:'#dc2626' }, t:{ fontSize:11 }, tOn:{ color:RenovaTheme.colors.surface } });
