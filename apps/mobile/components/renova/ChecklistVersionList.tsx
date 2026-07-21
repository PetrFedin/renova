import { useEffect, useState } from 'react';
import { RenovaTheme } from '@/constants/Theme';
import { View, Text, StyleSheet } from 'react-native';
import { api } from '@/lib/api';
import { reportCatch } from '@/lib/reportError';

export function ChecklistVersionList({ userId, projectId, tplId }: { userId: string; projectId?: string; tplId: string }) {
  const [vers, setVers] = useState<{ version: number; name: string; at: string }[]>([]);
  useEffect(() => {
    (projectId ? api.checklistTemplateVersions(userId, projectId, tplId) : api.userChecklistVersions(userId, tplId)).then(setVers).catch(reportCatch('components.renova.ChecklistVersionList.1'));
  }, [tplId]);
  if (!vers.length) return null;
  return (
    <View style={s.box}>
      <Text style={s.head}>История шаблона</Text>
      {vers.map(v => <Text key={v.version} style={s.line}>v{v.version} · {v.name} · {v.at.slice(0,10)}</Text>)}
    </View>
  );
}
const s = StyleSheet.create({ box:{ marginTop:8, padding:8, backgroundColor:RenovaTheme.colors.surfaceMuted, borderRadius:8 }, head:{ fontWeight:'700', fontSize:12 }, line:{ fontSize:11, color:'#555' } });
