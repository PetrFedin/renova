import { View, Text, Pressable, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';

const TPL = ['Качество не соответствует', 'Нужна уборка', 'Доработать стыки', 'Заменить материал', 'Повторная приёмка'];

export function RejectTemplates({ onPick }: { onPick: (t: string) => void }) {
  return (
    <View style={s.row}>{TPL.map(t => (
      <Pressable key={t} style={s.chip} onPress={() => onPick(t)}><Text style={s.t}>{t}</Text></Pressable>
    ))}</View>
  );
}
const s = StyleSheet.create({ row:{ flexDirection:'row', flexWrap:'wrap', gap:6, marginBottom:8 }, chip:{ backgroundColor:RenovaTheme.colors.dangerBg, paddingHorizontal:10, paddingVertical:6, borderRadius:14 }, t:{ fontSize:11, color:RenovaTheme.colors.dangerText } });
