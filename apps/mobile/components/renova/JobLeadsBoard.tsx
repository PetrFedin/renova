import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { api } from '@/lib/api';
import { LeadChat } from '@/components/renova/LeadChat';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { router } from 'expo-router';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';

type L = { id: string; title: string; address?: string; area_sqm?: number; renovation_type: string; budget_hint?: number; pre_estimate?: number; status: string };

export function JobLeadsBoard({ userId, role }: { userId: string; role: string }) {
  const { user, activeProject, loadProject, refreshProjects } = useRenova();
  const [items, setItems] = useState<L[]>([]);
  const [quote, setQuote] = useState<Record<string, string>>({});
  const load = useCallback(() => {
    api.listJobLeads(userId).then(setItems).catch(() => {});
  }, [userId]);
  useEffect(() => { load(); }, [load]);
  useProjectDataReload(load);
  return (
    <View style={s.box}>
      {role === 'contractor' && (
        <View style={s.info}>
          <Text style={s.infoT}>Новые объекты — через заявки</Text>
          <Text style={s.infoSub}>Ответьте КП → заказчик принимает → «→ Проект». Создать объект вручную нельзя (лимит Pro).</Text>
        </View>
      )}
      <Text style={s.head}>Заявки</Text>
      {items.map(l => (
        <View key={l.id} style={s.row}>
          <Text style={s.n}>{l.title} · {l.status}</Text>
          <Text style={s.sub}>{l.address} · {l.area_sqm} м² · {formatRub(l.budget_hint || 0)}</Text>
          {l.pre_estimate && <Text style={s.q}>Оценка: {formatRub(l.pre_estimate)}</Text>}
          <LeadChat userId={userId} leadId={l.id} />
          {role==='customer'&&l.status==='open'&&<PrimaryButton title="Авто-исполнитель" variant="outline" onPress={async()=>{await api.autoAssignLead(userId,l.id); await syncProjectSideEffects({ user: user ?? ({ id: userId } as any), project: activeProject }); load();}} />}
          {l.status==='quoted' && <PrimaryButton title="→ Проект" variant="outline" onPress={async()=>{ if(role==='contractor'){router.push({pathname:`/contractor-wizard/${l.id}`,params:{returnTo:'/job-leads'}} as any);return;} const r=await api.convertJobLead(userId,l.id); await refreshProjects(); if(r?.project_id) { await loadProject(r.project_id); router.replace(role === 'contractor' ? '/(contractor)/(tabs)/' : '/(customer)/(tabs)/'); } load(); }} />}
          {role === 'contractor' && l.status === 'open' && (
            <View style={s.qrow}>
              <TextInput style={s.inp} placeholder="₽" keyboardType="numeric" value={quote[l.id] || ''} onChangeText={v => setQuote({ ...quote, [l.id]: v })} />
              <PrimaryButton title="КП" onPress={async () => { await api.quoteJobLead(userId, l.id, parseFloat(quote[l.id] || '0')); await syncProjectSideEffects({ user: user ?? ({ id: userId } as any), project: activeProject }); load(); }} />
            </View>
          )}
        </View>
      ))}
      {role === 'customer' && <PrimaryButton title="+ Заявка" variant="outline" onPress={async () => { await api.createJobLead(userId, { title: 'Ремонт квартиры', area_sqm: 55, renovation_type: 'capital', budget_hint: 800000 }); await syncProjectSideEffects({ user: user ?? ({ id: userId } as any), project: activeProject }); load(); }} />}
    </View>
  );
}
const s = StyleSheet.create({ info:{ backgroundColor:RenovaTheme.colors.infoBg, padding:12, borderRadius:10, marginBottom:10, borderWidth:1, borderColor:"#BFDBFE" }, infoT:{ fontWeight:"700", marginBottom:4 }, infoSub:{ fontSize:12, color:"#475569", lineHeight:17 }, box:{ marginVertical:10 }, head:{ fontWeight:'800', marginBottom:8 }, row:{ backgroundColor:RenovaTheme.colors.surface, padding:10, borderRadius:8, marginBottom:6 }, n:{ fontWeight:'600' }, sub:{ fontSize:11, color:'#666' }, q:{ fontWeight:'700', color:'#2563eb', marginTop:4 }, qrow:{ flexDirection:'row', gap:8, marginTop:6, alignItems:'center' }, inp:{ borderWidth:1, borderColor:'#ddd', borderRadius:8, padding:8, flex:1 } });
