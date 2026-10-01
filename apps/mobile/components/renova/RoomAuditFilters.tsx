import { useState } from 'react';
import { View, TextInput, Text, Pressable, StyleSheet } from 'react-native';
import { checkOptionalDate } from '@/lib/validateDate';

export function RoomAuditFilters({ onFilter }: { onFilter: (f: { field?: string; since?: string }) => void }) {
  const [field, setField] = useState('');
  const [since, setSince] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <View style={s.wrap}>
      <Text style={s.lbl}>Фильтр аудита</Text>
      <TextInput style={s.inp} placeholder="Поле (розетки, площадь…)" value={field} onChangeText={setField} />
      <TextInput style={s.inp} placeholder="Дата с (ДД.ММ.ГГГГ)" value={since} onChangeText={(v: string) => { setSince(v); setErr(null); }} />
      {err ? <Text style={s.err}>{err}</Text> : null}
      <Pressable onPress={() => {
        const d = checkOptionalDate(since, 'Дата');
        if (!d.ok) { setErr(d.error); return; }
        setErr(null);
        onFilter({ field: field || undefined, since: d.iso });
      }}><Text style={s.btn}>Применить</Text></Pressable>
    </View>
  );
}
const s = StyleSheet.create({ wrap:{ marginVertical:8 }, lbl:{ fontSize:12, fontWeight:'600' }, inp:{ borderWidth:1, borderColor:'#ddd', borderRadius:6, padding:6, marginTop:4, fontSize:12 }, btn:{ color:'#2563eb', marginTop:6, fontSize:12 }, err:{ color:'#B91C1C', marginTop:4, fontSize:12 } });
