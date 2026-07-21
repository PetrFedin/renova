import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { api, WasteOrder } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { alertWasteOrderAdvanced } from '@/lib/siteOpsNav';
import type { OsRole } from '@/constants/osSections';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { reportCatch } from '@/lib/reportError';

/** W114: UI офлайн для вывоза мусора (API уже в offlineQueue) */
async function runWasteAction(
  label: string,
  action: () => Promise<unknown>,
  after: () => Promise<void> | void,
) {
  try {
    await action();
    await after();
  } catch (e) {
    if (isOfflineQueued(e)) {
      notifyOfflineQueued(label);
      await after();
      return;
    }
    Alert.alert('Ошибка', e instanceof Error ? e.message : 'Не удалось выполнить действие');
  }
}

export function WasteOrderList({ userId, projectId, role }: { userId: string; projectId: string; role: string }) {
  const { user, activeProject } = useRenova();
  const syncAfter = () => syncProjectSideEffects({ user: user ?? ({ id: userId } as any), project: activeProject ?? ({ id: projectId } as any), role });
  const [items, setItems] = useState<WasteOrder[]>([]);
  const load = useCallback(() => {
    api.listWasteOrders(userId, projectId).then(setItems).catch(reportCatch('components.renova.WasteOrderList.1'));
  }, [userId, projectId]);
  useEffect(() => { load(); }, [load]);
  useProjectDataReload(load);
  return (
    <View style={s.box}>
      <Text style={s.head}>Вывоз мусора</Text>
      {items.map(w => (
        <View key={w.id} style={s.row}>
          <Text style={s.n}>{w.volume_m3} м³ · {w.status}</Text>
          <Text style={s.m}>{formatRub(w.total || w.price)}</Text>
          {role === 'contractor' && w.status === 'draft' && (
            <PrimaryButton
              title="Заказать"
              variant="outline"
              onPress={() => runWasteAction('Заказ вывоза', () => api.requestWasteOrder(userId, projectId, w.id), async () => { await syncAfter(); load(); alertWasteOrderAdvanced(role as OsRole, 'requested'); })}
            />
          )}
          {role === 'customer' && w.status === 'requested' && (
            <PrimaryButton
              title="Согласовать"
              onPress={() => runWasteAction('Согласование вывоза', () => api.approveWasteOrder(userId, projectId, w.id), async () => { await syncAfter(); load(); alertWasteOrderAdvanced(role as OsRole, 'approved'); })}
            />
          )}
          {role === 'contractor' && w.status === 'approved' && (
            <PrimaryButton
              title="Вывезено"
              onPress={() => runWasteAction('Завершение вывоза', () => api.completeWasteOrder(userId, projectId, w.id), async () => { await syncAfter(); load(); alertWasteOrderAdvanced(role as OsRole, 'completed'); })}
            />
          )}
        </View>
      ))}
      {role === 'contractor' && (
        <PrimaryButton
          title="+ Контейнер 8 м³"
          variant="outline"
          onPress={() => runWasteAction(
            'Заявка на контейнер',
            () => api.createWasteOrder(userId, projectId, { volume_m3: 8, price: 4500, waste_type: 'construction', notes: 'Строительный мусор' }),
            async () => { await syncAfter(); load(); alertWasteOrderAdvanced(role as OsRole, 'created'); },
          )}
        />
      )}
    </View>
  );
}
const s = StyleSheet.create({ box:{ marginVertical:10 }, head:{ fontWeight:'800', marginBottom:8 }, row:{ backgroundColor:RenovaTheme.colors.surface, padding:10, borderRadius:8, marginBottom:6 }, n:{ fontWeight:'600' }, m:{ fontSize:12, color:'#666' } });
