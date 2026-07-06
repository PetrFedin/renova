import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { DetailPreset, PRESET_LABELS, getDetailPreset, applyDetailPreset } from '@/lib/detailLevel';

const KEYS: DetailPreset[] = ['cosmetic', 'capital', 'house'];

export function DetailPresetPicker({ onChange }: { onChange?: (p: DetailPreset) => void }) {
  const [p, setP] = useState<DetailPreset>('capital');
  useEffect(() => { getDetailPreset().then(setP); }, []);
  return (
    <View style={s.row}>
      {KEYS.map(k => (
        <Pressable key={k} style={[s.chip, p === k && s.on]} onPress={async () => { await applyDetailPreset(k); setP(k); onChange?.(k); }}>
          <Text style={[s.t, p === k && s.onT]}>{PRESET_LABELS[k]}</Text>
        </Pressable>
      ))}
    </View>
  );
}
const s = StyleSheet.create({ row:{ flexDirection:'row', gap:6, marginVertical:8 }, chip:{ paddingHorizontal:10, paddingVertical:6, borderRadius:16, backgroundColor:'#eee' }, on:{ backgroundColor:'#2563eb' }, t:{ fontSize:12 }, onT:{ color:'#fff', fontWeight:'700' } });
