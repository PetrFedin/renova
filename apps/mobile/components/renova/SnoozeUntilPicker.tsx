import { useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet, Platform } from 'react-native';
import { api } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { parseDateTimeInput } from '@/lib/validateDate';
import { useBusyAction } from '@/lib/hooks/useBusyAction';

export function SnoozeUntilPicker({ userId, notificationId, onDone }: { userId: string; notificationId: string; onDone: () => void }) {
  const { user, activeProject } = useRenova();
  const [dt, setDt] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const action = useBusyAction();
  const pick = (days: number) => {
    const d = new Date(); d.setDate(d.getDate() + days); d.setHours(9,0,0,0);
    setDt(d.toISOString().slice(0, 16));
  };
  const save = () => {
    const iso = parseDateTimeInput(dt);
    if (!iso) { setErr('Введите дату и время: ДД.ММ.ГГГГ ЧЧ:ММ или ГГГГ-ММ-ДД ЧЧ:ММ'); return; }
    setErr(null);
    void action.run(async () => {
      await api.snoozeNotificationUntil(userId, notificationId, iso);
      await syncProjectSideEffects({ user: user ?? ({ id: userId } as any), project: activeProject });
      onDone();
    }, 'Не удалось отложить');
  };
  return (
    <View style={s.wrap}>
      <View style={s.quick}>{[1,3,7].map(d => <Pressable key={d} onPress={() => pick(d)}><Text style={s.q}>+{d}д 09:00</Text></Pressable>)}</View>
      {Platform.OS === 'web' ? (
        // @ts-ignore web datetime-local
        <input type="datetime-local" value={dt} onChange={(e: any) => { setDt(e.target.value); setErr(null); }} style={{ fontSize: 11, marginBottom: 4 }} />
      ) : (
        <TextInput style={s.inp} placeholder="ДД.ММ.ГГГГ ЧЧ:ММ" value={dt} onChangeText={(v: string) => { setDt(v); setErr(null); }} />
      )}
      {err ? <Text style={s.err}>{err}</Text> : null}
      <Pressable onPress={save} disabled={action.busy}><Text style={s.btn}>{action.busy ? 'Откладываем…' : 'Отложить до'}</Text></Pressable>
    </View>
  );
}
const s = StyleSheet.create({ wrap:{ marginTop:4 }, quick:{ flexDirection:'row', gap:8, marginBottom:4 }, q:{ fontSize:11, color:'#6366f1' }, inp:{ borderWidth:1, borderColor:'#ddd', borderRadius:6, padding:4, fontSize:11 }, btn:{ color:'#6366f1', fontSize:11 }, err:{ color:'#B91C1C', fontSize:11, marginBottom:4 } });
