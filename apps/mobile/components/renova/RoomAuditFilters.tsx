import { useState } from 'react';
import { View, TextInput, Text, Pressable, StyleSheet } from 'react-native';

export function RoomAuditFilters({ onFilter }: { onFilter: (f: { field?: string; since?: string }) => void }) {
  const [field, setField] = useState('');
  const [since, setSince] = useState('');
  return (
    <View style={s.wrap}>
      <Text style={s.lbl}>Фильтр аудита</Text>
      <TextInput style={s.inp} placeholder="Поле (розетки, площадь…)" value={field} onChangeText={setField} />
      <TextInput style={s.inp} placeholder="Дата с (ГГГГ-ММ-ДД)" value={since} onChangeText={setSince} />
      <Pressable onPress={() => onFilter({ field: field || undefined, since: since || undefined })}><Text style={s.btn}>Применить</Text></Pressable>
    </View>
  );
}
const s = StyleSheet.create({ wrap:{ marginVertical:8 }, lbl:{ fontSize:12, fontWeight:'600' }, inp:{ borderWidth:1, borderColor:'#ddd', borderRadius:6, padding:6, marginTop:4, fontSize:12 }, btn:{ color:'#2563eb', marginTop:6, fontSize:12 } });
