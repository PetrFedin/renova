import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { api } from '@/lib/api';

export function WorkTypeFilter({ value, onChange }: { value?: string; onChange: (v?: string) => void }) {
  const [types, setTypes] = useState<{ code: string; name: string }[]>([]);
  useEffect(() => { api.listWorkTypes().then(setTypes).catch(() => {}); }, []);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.row}>
      <Pressable style={[s.ch, !value && s.on]} onPress={() => onChange(undefined)}><Text style={s.t}>Все</Text></Pressable>
      {types.map(t => <Pressable key={t.code} style={[s.ch, value===t.code && s.on]} onPress={() => onChange(t.code)}><Text style={s.t}>{t.name}</Text></Pressable>)}
    </ScrollView>
  );
}
const s = StyleSheet.create({ row:{ marginBottom:8 }, ch:{ paddingHorizontal:10, paddingVertical:5, borderRadius:12, backgroundColor:'#eee', marginRight:6 }, on:{ backgroundColor:'#2563eb' }, t:{ fontSize:11, color:'#333' } });
