import { View, Text, StyleSheet } from 'react-native';
// Только то, что уровень детализации реально меняет (lib/detailLevelPolicy.ts).
const BLOCKS: Record<string, string[]> = {
  brief: ['Прогресс и бюджет', 'Короткие подсказки'],
  standard: ['Прогресс и бюджет', 'Блок «Риски» и аналитика', 'Подсказки в одну строку'],
  detailed: ['Прогресс и бюджет', 'Блок «Риски» и аналитика', 'Развёрнутые подсказки', 'Фильтры по статьям сметы'],
};
export function DetailLevelPreview({ mode }: { mode: string }) {
  const items = BLOCKS[mode] || BLOCKS.standard;
  return (
    <View style={s.box}>
      <Text style={s.head}>Что изменится</Text>
      {items.map(x => <View key={x} style={s.row}><Text style={s.dot}>•</Text><Text>{x}</Text></View>)}
    </View>
  );
}
const s = StyleSheet.create({ box:{ backgroundColor:'#f8fafc', padding:12, borderRadius:10, marginTop:12 }, head:{ fontWeight:'700', marginBottom:6 }, row:{ flexDirection:'row', gap:6, paddingVertical:2 }, dot:{ color:'#2563eb' } });
