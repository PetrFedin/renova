import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { api, FurnitureItem } from '@/lib/api';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { PrimaryButton } from '@/components/renova/PrimaryButton';

export function FurnitureLayer({ userId, projectId, planId, role }: { userId: string; projectId: string; planId?: string; role: string }) {
  const { user, activeProject } = useRenova();
  const [items, setItems] = useState<FurnitureItem[]>([]);
  const load = () => api.listFurniture(userId, projectId).then(setItems).catch(() => {});
  useEffect(() => { load(); }, [projectId]);
  const move = async (id: string, dx: number, dy: number, x?: number | null, y?: number | null) => {
    const nx = Math.min(95, Math.max(5, (x ?? 50) + dx));
    const ny = Math.min(95, Math.max(5, (y ?? 50) + dy));
    try {
      await api.moveFurniture(userId, projectId, id, nx, ny);
      load();
    } catch (e) {
      if (isOfflineQueued(e)) notifyOfflineQueued('Мебель на плане');
    }
  };
  return (
    <View style={s.box}>
      <Text style={s.head}>Мебель</Text>
      {items.map(f => (
        <View key={f.id} style={s.row}>
          <Text style={s.t}>{f.name} {f.width_m}×{f.depth_m}м</Text>
          {role === 'contractor' && f.x_pct != null && (
            <View style={s.ar}><Pressable onPress={() => move(f.id, -5, 0, f.x_pct, f.y_pct)}><Text>←</Text></Pressable><Pressable onPress={() => move(f.id, 5, 0, f.x_pct, f.y_pct)}><Text>→</Text></Pressable></View>
          )}
        </View>
      ))}
      {role === 'contractor' && planId && <PrimaryButton title="+ Диван" variant="outline" onPress={async () => { try { await api.createFurniture(userId, projectId, { name: 'Диван', width_m: 2.1, depth_m: 0.9, floor_plan_id: planId, x_pct: 30, y_pct: 60 }); await syncProjectSideEffects({ user: user ?? ({ id: userId } as any), project: activeProject ?? ({ id: projectId } as any) }); } catch { await api.enqueueOfflineCreate(`/api/v1/projects/${projectId}/furniture`, 'POST', { name: 'Диван', floor_plan_id: planId }, userId); } load(); }} />}
    </View>
  );
}
const s = StyleSheet.create({ box:{ marginTop:8 }, head:{ fontWeight:'700', fontSize:12 }, row:{ flexDirection:'row', justifyContent:'space-between', marginBottom:4 }, t:{ fontSize:12 }, ar:{ flexDirection:'row', gap:8 } });
