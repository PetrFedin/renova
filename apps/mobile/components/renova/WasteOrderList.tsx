import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { api, WasteOrder } from '@/lib/api';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme, formatRub } from '@/constants/Theme';

export function WasteOrderList({ userId, projectId, role }: { userId: string; projectId: string; role: string }) {
  const [items, setItems] = useState<WasteOrder[]>([]);
  const load = () => api.listWasteOrders(userId, projectId).then(setItems).catch(() => {});
  useEffect(() => { load(); }, [projectId]);
  return (
    <View style={s.box}>
      <Text style={s.head}>Вывоз мусора</Text>
      {items.map(w => (
        <View key={w.id} style={s.row}>
          <Text style={s.n}>{w.volume_m3} м³ · {w.status}</Text>
          <Text style={s.m}>{formatRub(w.total || w.price)}</Text>
          {role === 'contractor' && w.status === 'draft' && <PrimaryButton title="Заказать" variant="outline" onPress={async () => { await api.requestWasteOrder(userId, projectId, w.id); load(); }} />}
          {role === 'customer' && w.status === 'requested' && <PrimaryButton title="Согласовать" onPress={async () => { await api.approveWasteOrder(userId, projectId, w.id); load(); }} />}
          {role === 'contractor' && w.status === 'approved' && <PrimaryButton title="Вывезено" onPress={async () => { await api.completeWasteOrder(userId, projectId, w.id); load(); }} />}
        </View>
      ))}
      {role === 'contractor' && <PrimaryButton title="+ Контейнер 8 м³" variant="outline" onPress={async () => { await api.createWasteOrder(userId, projectId, { volume_m3: 8, price: 4500, waste_type: 'construction', notes: 'Строительный мусор' }); load(); }} />}
    </View>
  );
}
const s = StyleSheet.create({ box:{ marginVertical:10 }, head:{ fontWeight:'800', marginBottom:8 }, row:{ backgroundColor:RenovaTheme.colors.surface, padding:10, borderRadius:8, marginBottom:6 }, n:{ fontWeight:'600' }, m:{ fontSize:12, color:'#666' } });
