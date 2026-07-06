import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { fieldDiff } from '@/lib/fieldDiff';
import { MergePreview } from '@/components/renova/MergePreview';

export function FieldMergePicker({ local, server, onMerge }: { local: string; server?: string; onMerge: (merged: string) => void }) {
  const diffs = fieldDiff(local, server);
  const [pick, setPick] = useState<Record<string, 'local'|'server'>>({});
  const [preview, setPreview] = useState('');
  const apply = () => {
    let obj: Record<string, unknown> = {};
    try { obj = JSON.parse(local); } catch {}
    let srv: Record<string, unknown> = {};
    try { srv = server ? JSON.parse(server) : {}; } catch {}
    diffs.forEach(d => { const src = (pick[d.field] || 'local') === 'server' ? srv : obj; obj[d.field] = src[d.field]; });
    const merged = JSON.stringify(obj);
    setPreview(merged);
    onMerge(merged);
  };
  if (!diffs.length) return null;
  return (
    <View style={s.box}>
      <Text style={s.head}>Слияние по полям</Text>
      {diffs.map(d => (
        <View key={d.field} style={s.row}>
          <Text style={s.f}>{d.field}</Text>
          <Pressable onPress={() => setPick(p => ({...p, [d.field]: 'local'}))}><Text style={[s.b, pick[d.field]==='local' && s.on]}>Лок</Text></Pressable>
          <Pressable onPress={() => setPick(p => ({...p, [d.field]: 'server'}))}><Text style={[s.b, pick[d.field]==='server' && s.on]}>Сервер</Text></Pressable>
        </View>
      ))}
      {preview ? <MergePreview json={preview} /> : null}
      <Pressable onPress={apply}><Text style={s.apply}>Применить слияние</Text></Pressable>
    </View>
  );
}
const s = StyleSheet.create({ box:{ marginTop:8, padding:8, backgroundColor:'#eff6ff', borderRadius:8 }, head:{ fontWeight:'700', fontSize:12 }, row:{ flexDirection:'row', gap:6, marginVertical:4, alignItems:'center' }, f:{ flex:1, fontSize:11 }, b:{ fontSize:11, padding:4, backgroundColor:'#eee', borderRadius:4 }, on:{ backgroundColor:'#2563eb', color:'#fff' }, apply:{ color:'#2563eb', fontWeight:'700', marginTop:6 } });
