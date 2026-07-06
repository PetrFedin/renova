import { useEffect, useState } from 'react';
import { RenovaTheme } from '@/constants/Theme';
import { View, Text, StyleSheet } from 'react-native';
import { api } from '@/lib/api';

export function ChecklistVersionDiff({ userId, projectId, tplId }: { userId: string; projectId: string; tplId: string }) {
  const [diff, setDiff] = useState<{ added: string[]; removed: string[] } | null>(null);
  useEffect(() => { api.checklistDiff(userId, projectId, tplId).then(setDiff).catch(() => {}); }, [tplId]);
  if (!diff) return null;
  return (
    <View style={s.row}>
      <View style={s.col}><Text style={s.head}>Версия 1</Text>{diff.removed.map(x => <Text key={'r'+x} style={s.rm}>- {x}</Text>)}</View>
      <View style={s.col}><Text style={s.head}>Версия 2</Text>{diff.added.map(x => <Text key={'a'+x} style={s.add}>+ {x}</Text>)}</View>
    </View>
  );
}
const s = StyleSheet.create({ row:{ flexDirection:'row', gap:8, marginTop:8 }, col:{ flex:1, backgroundColor:RenovaTheme.colors.surfaceMuted, padding:8, borderRadius:8 }, head:{ fontWeight:'700', fontSize:12 }, add:{ color:'#15803d', fontSize:11 }, rm:{ color:'#b91c1c', fontSize:11 } });
