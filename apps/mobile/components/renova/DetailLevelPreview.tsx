import { View, Text, StyleSheet } from 'react-native';
const BLOCKS: Record<string, string[]> = {
  brief: ['Прогресс %', 'Бюджет итого'],
  standard: ['Прогресс', 'План и факт', 'Этапы', 'Уведомления'],
  detailed: ['КПЭ', 'План и факт', 'Журнал комнат', 'Офлайн', 'Реакции', 'Экспорт документов'],
};
export function DetailLevelPreview({ mode }: { mode: string }) {
  const items = BLOCKS[mode] || BLOCKS.standard;
  return (
    <View style={s.box}>
      <Text style={s.head}>Превью главной</Text>
      {items.map(x => <View key={x} style={s.row}><Text style={s.dot}>•</Text><Text>{x}</Text></View>)}
    </View>
  );
}
const s = StyleSheet.create({ box:{ backgroundColor:'#f8fafc', padding:12, borderRadius:10, marginTop:12 }, head:{ fontWeight:'700', marginBottom:6 }, row:{ flexDirection:'row', gap:6, paddingVertical:2 }, dot:{ color:'#2563eb' } });
