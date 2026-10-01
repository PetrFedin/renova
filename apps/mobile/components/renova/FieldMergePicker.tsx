import { useState } from 'react';
import { RenovaTheme } from '@/constants/Theme';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { fieldDiff, mergeFieldChoices } from '@/lib/fieldDiff';
import { MergePreview } from '@/components/renova/MergePreview';

export function FieldMergePicker({ local, server, onMerge }: { local: string; server?: string; onMerge: (merged: string) => void }) {
  const diffs = fieldDiff(local, server);
  const [pick, setPick] = useState<Record<string, 'local'|'server'>>({});
  const [preview, setPreview] = useState('');
  const apply = () => {
    const merged = mergeFieldChoices(local, server, pick);
    setPreview(merged);
    onMerge(merged);
  };
  // INB-07: без серверной версии выбирать нечего — не предлагаем «Сервер», который стёр бы поле
  if (!server) return null;
  if (!diffs.length) return null;
  return (
    <View style={s.box}>
      <Text style={s.head}>Слияние по полям</Text>
      {diffs.map(d => (
        <View key={d.field} style={s.row}>
          <Text style={s.f}>{d.field}</Text>
          <Pressable onPress={() => setPick(p => ({...p, [d.field]: 'local'}))} accessibilityRole="button" accessibilityLabel={`${d.field}: оставить моё значение`} accessibilityState={{ selected: pick[d.field]==='local' }} hitSlop={8}><Text style={[s.b, pick[d.field]==='local' && s.on]}>Моё</Text></Pressable>
          <Pressable onPress={() => setPick(p => ({...p, [d.field]: 'server'}))} accessibilityRole="button" accessibilityLabel={`${d.field}: взять значение с сервера`} accessibilityState={{ selected: pick[d.field]==='server' }} hitSlop={8}><Text style={[s.b, pick[d.field]==='server' && s.on]}>Сервер</Text></Pressable>
        </View>
      ))}
      {preview ? <MergePreview json={preview} /> : null}
      <Pressable onPress={apply} accessibilityRole="button" accessibilityLabel="Применить слияние" style={{ minHeight: RenovaTheme.minTouch, justifyContent: 'center' }}><Text style={s.apply}>Применить слияние</Text></Pressable>
    </View>
  );
}
const s = StyleSheet.create({ box:{ marginTop:8, padding:8, backgroundColor:RenovaTheme.colors.infoBg, borderRadius:8 }, head:{ fontWeight:'700', fontSize:12 }, row:{ flexDirection:'row', gap:6, marginVertical:4, alignItems:'center' }, f:{ flex:1, fontSize:11 }, b:{ fontSize:11, padding:4, backgroundColor:RenovaTheme.colors.border, borderRadius:4 }, on:{ backgroundColor:RenovaTheme.colors.accent, color:RenovaTheme.colors.surface }, apply:{ color:RenovaTheme.colors.accent, fontWeight:'700', marginTop:6 } });
