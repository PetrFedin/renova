import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
export function MergePreview({ json }: { json: string }) {
  return <View style={s.box}><Text style={s.head}>Превью слияния</Text><Text style={s.code}>{json}</Text></View>;
}
const s = StyleSheet.create({ box:{ backgroundColor:RenovaTheme.colors.successBg, padding:8, borderRadius:8, marginTop:6 }, head:{ fontWeight:'700', fontSize:11 }, code:{ fontSize:10, fontFamily:'monospace' } });
