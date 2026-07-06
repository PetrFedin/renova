import { useState } from 'react';
import { RenovaTheme } from '@/constants/Theme';
import { TextInput, View, Text, Pressable, StyleSheet } from 'react-native';
import { HighlightText } from '@/components/renova/HighlightText';

export function ChatInThreadSearch({ messages, onJump, onQueryChange }: { messages: { id: string; text: string }[]; onJump: (id: string) => void; onQueryChange?: (q: string) => void }) {
  const [q, setQ] = useState('');
  const hits = messages.filter(m => q.trim() && m.text.toLowerCase().includes(q.toLowerCase())).slice(0, 5);
  return (
    <View style={s.wrap}>
      <TextInput style={s.input} placeholder="Поиск в чате…" value={q} onChangeText={v => { setQ(v); onQueryChange?.(v); }} />
      {hits.map(m => <Pressable key={m.id} onPress={() => onJump(m.id)}><Text style={s.hit} numberOfLines={1}><HighlightText text={m.text} query={q} /></Text></Pressable>)}
    </View>
  );
}
const s = StyleSheet.create({ wrap:{ marginBottom:8 }, input:{ backgroundColor:RenovaTheme.colors.surface, borderRadius:8, padding:8, borderWidth:1, borderColor:RenovaTheme.colors.border }, hit:{ padding:6, fontSize:12, color:'#2563eb' } });
