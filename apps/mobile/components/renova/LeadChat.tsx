import { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { api } from '@/lib/api';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { reportCatch } from '@/lib/reportError';

export function LeadChat({ userId, leadId }: { userId: string; leadId: string }) {
  const { user, activeProject } = useRenova();
  const [msgs, setMsgs] = useState<{ text: string; at: string }[]>([]);
  const [text, setText] = useState('');
  const load = () => api.leadMessages(userId, leadId).then(setMsgs).catch(reportCatch('components.renova.LeadChat.1'));
  useEffect(() => { load(); }, [leadId]);
  return (
    <View style={s.box}>
      {msgs.map((m, i) => <Text key={i} style={s.m}>{m.text}</Text>)}
      <TextInput style={s.inp} value={text} onChangeText={setText} placeholder="Сообщение" />
      <PrimaryButton title="Отправить" onPress={async () => { if (!text.trim()) return; await api.postLeadMessage(userId, leadId, text); await syncProjectSideEffects({ user: user ?? ({ id: userId } as any), project: activeProject }); setText(''); load(); }} />
    </View>
  );
}
const s = StyleSheet.create({ box:{ marginTop:8, padding:8, backgroundColor:'#f9fafb', borderRadius:8 }, m:{ fontSize:12, marginBottom:4 }, inp:{ borderWidth:1, borderColor:'#ddd', borderRadius:8, padding:8, marginVertical:6 } });
