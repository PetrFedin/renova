import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { api } from '@/lib/api';

export function ChecklistVersionList({ userId, projectId, tplId }: { userId: string; projectId?: string; tplId: string }) {
  const [vers, setVers] = useState<{ version: number; name: string; at: string }[]>([]);
  useEffect(() => {
    (projectId ? api.checklistTemplateVersions(userId, projectId, tplId) : api.userChecklistVersions(userId, tplId)).then(setVers).catch(() => {});
  }, [tplId]);
  if (!vers.length) return null;
  return (
    <View style={s.box}>
      <Text style={s.head}>История шаблона</Text>
      {vers.map(v => <Text key={v.version} style={s.line}>v{v.version} · {v.name} · {v.at.slice(0,10)}</Text>)}
    </View>
  );
}
const s = StyleSheet.create({ box:{ marginTop:8, padding:8, backgroundColor:'#f3f4f6', borderRadius:8 }, head:{ fontWeight:'700', fontSize:12 }, line:{ fontSize:11, color:'#555' } });
