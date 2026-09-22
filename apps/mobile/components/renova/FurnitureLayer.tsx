import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { api, FurnitureItem } from '@/lib/api';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { reportCatch } from '@/lib/reportError';
import { confirmDestructive } from '@/lib/confirmAlert';
import { RenovaTheme } from '@/constants/Theme';

export function FurnitureLayer({ userId, projectId, planId, role }: { userId: string; projectId: string; planId?: string; role: string }) {
  const { user, activeProject } = useRenova();
  const [items, setItems] = useState<FurnitureItem[]>([]);
  const load = useCallback(() => {
    api.listFurniture(userId, projectId).then(setItems).catch(reportCatch('components.renova.FurnitureLayer.1'));
  }, [userId, projectId]);
  useEffect(() => { load(); }, [load]);
  useProjectDataReload(load);
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
  const remove = async (item: FurnitureItem) => {
    const ok = await confirmDestructive(
      'Убрать предмет?',
      `«${item.name}» исчезнет из списка мебели и с плана.`,
    );
    if (!ok) return;
    try {
      await api.deleteFurniture(userId, projectId, item.id);
      load();
    } catch (e) {
      if (isOfflineQueued(e)) notifyOfflineQueued('Удаление мебели');
    }
  };

  return (
    <View style={s.box}>
      <Text style={s.head}>Мебель</Text>
      {items.map(f => (
        <View key={f.id} style={s.row}>
          <Text style={s.t}>{f.name} {f.width_m}×{f.depth_m}м</Text>
          {role === 'contractor' && (
            <View style={s.ar}>
              {f.x_pct != null ? (
                <>
                  <Pressable
                    style={s.tap}
                    accessibilityRole="button"
                    accessibilityLabel={`Сдвинуть «${f.name}» влево`}
                    onPress={() => move(f.id, -5, 0, f.x_pct, f.y_pct)}
                  >
                    <Text style={s.tapT}>←</Text>
                  </Pressable>
                  <Pressable
                    style={s.tap}
                    accessibilityRole="button"
                    accessibilityLabel={`Сдвинуть «${f.name}» вправо`}
                    onPress={() => move(f.id, 5, 0, f.x_pct, f.y_pct)}
                  >
                    <Text style={s.tapT}>→</Text>
                  </Pressable>
                </>
              ) : null}
              <Pressable
                style={s.tap}
                accessibilityRole="button"
                accessibilityLabel={`Убрать «${f.name}»`}
                onPress={() => { void remove(f); }}
              >
                <Text style={s.tapT}>✕</Text>
              </Pressable>
            </View>
          )}
        </View>
      ))}
      {role === 'contractor' && planId && <PrimaryButton title="+ Диван" variant="outline" onPress={async () => { try { await api.createFurniture(userId, projectId, { name: 'Диван', width_m: 2.1, depth_m: 0.9, floor_plan_id: planId, x_pct: 30, y_pct: 60 }); await syncProjectSideEffects({ user: user ?? ({ id: userId } as any), project: activeProject ?? ({ id: projectId } as any) }); } catch { await api.enqueueOfflineCreate(`/api/v1/projects/${projectId}/furniture`, 'POST', { name: 'Диван', floor_plan_id: planId }, userId); } load(); }} />}
    </View>
  );
}
const s = StyleSheet.create({
  box: { marginTop: 8 },
  head: { fontWeight: '700', fontSize: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  t: { flex: 1, fontSize: 12 },
  ar: { flexDirection: 'row', gap: 8 },
  // Стрелки и крестик были голым текстом ~14px — меньше порога касания.
  tap: { minWidth: RenovaTheme.minTouch, minHeight: RenovaTheme.minTouch, alignItems: 'center', justifyContent: 'center' },
  tapT: { fontSize: RenovaTheme.fontSize.h3, color: RenovaTheme.colors.text },
});
