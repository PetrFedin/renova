/** Подбор материалов с привязкой к комнате */
import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, Linking, StyleSheet, TextInput } from 'react-native';
import { api, MaterialPick, Room, Stage } from '@/lib/api';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { materialPickStatusLabel } from '@/constants/labels';
import { WorkTypeFilter } from '@/components/renova/WorkTypeFilter';
import { RoomPickerChips } from '@/components/renova/RoomPickerChips';
import { useNavFromHere } from '@/lib/navigation';
import type { OsRole } from '@/constants/osSections';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';

export function MaterialPickList({
  userId,
  projectId,
  role,
  rooms = [],
  stages = [],
  picksOverride,
  readOnly,
}: {
  userId: string;
  projectId: string;
  role: OsRole;
  rooms?: Room[];
  stages?: Stage[];
  picksOverride?: MaterialPick[];
  readOnly?: boolean;
}) {
  const nav = useNavFromHere();
  const { user, activeProject } = useRenova();
  const [items, setItems] = useState<MaterialPick[]>([]);
  const [wt, setWt] = useState<string | undefined>();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const load = useCallback(() => {
    api.listMaterialPicks(userId, projectId, wt).then(setItems).catch(() => {});
  }, [userId, projectId, wt]);
  const syncAfter = async () => {
    await syncProjectSideEffects({
      user: user ?? ({ id: userId } as any),
      project: activeProject ?? ({ id: projectId } as any),
      role,
    });
  };
  useEffect(() => { if (!picksOverride) load(); }, [load, picksOverride]);
  const onBusReload = useCallback(() => { if (!picksOverride) load(); }, [picksOverride, load]);
  useProjectDataReload(onBusReload);
  useEffect(() => { if (picksOverride) setItems(picksOverride); }, [picksOverride]);
  const visible = picksOverride ?? items;
  const roomName = (id?: string | null) => rooms.find((r) => r.id === id)?.name;
  return (
    <View style={s.box}>
      <Text style={s.head}>Подбор материалов</Text>
      <WorkTypeFilter value={wt} onChange={setWt} />
      {visible.map((p) => (
        <Pressable key={p.id} style={s.row} onPress={() => nav.material(p.id)}>
          <Text style={s.n}>{p.name} · {materialPickStatusLabel(p.status)}{p.room_id && roomName(p.room_id) ? ` · ${roomName(p.room_id)}` : ''}</Text>
          <Text style={s.m}>{p.qty} {p.unit} · {formatRub(p.total)} {p.analog_of_id ? '· аналог' : ''}</Text>
          {p.shop_url && role === 'contractor' && (
            <PrimaryButton title="↻ цена" variant="outline" onPress={async () => { await api.syncMaterialPrice(userId, projectId, p.id); load(); }} />
          )}
          {p.shop_url && (
            <Pressable onPress={() => Linking.openURL(p.shop_url!)}>
              <Text style={s.link}>{p.shop_name || p.shop_url}</Text>
            </Pressable>
          )}
          {!readOnly && role === 'customer' && p.status === 'pending' && (
            <PrimaryButton title="Согласовать" onPress={async () => { await api.approveMaterialPick(userId, projectId, p.id); await syncAfter(); load(); }} />
          )}
          {!readOnly && role === 'contractor' && p.status === 'draft' && (
            <PrimaryButton title="На согласование" variant="outline" onPress={async () => { await api.submitMaterialPick(userId, projectId, p.id); await syncAfter(); load(); }} />
          )}
        </Pressable>
      ))}
      {role === 'contractor' && showForm && (
        <View style={s.form}>
          <TextInput style={s.inp} placeholder="Название" value={name} onChangeText={setName} />
          <TextInput style={s.inp} placeholder="Цена" value={price} onChangeText={setPrice} keyboardType="numeric" />
          {rooms.length > 0 && <RoomPickerChips rooms={rooms} value={roomId} onChange={setRoomId} optional={false} />}
          <PrimaryButton title="Сохранить" onPress={async () => {
            await api.createMaterialPick(userId, projectId, { name: name || 'Материал', price: Number(price) || 0, qty: 1, unit: 'шт', work_type: wt, room_id: roomId });
            setName(''); setPrice(''); setRoomId(null); setShowForm(false); await syncAfter(); load();
          }} />
        </View>
      )}
      {role === 'contractor' && !showForm && !readOnly && (
        <PrimaryButton title="+ Материал" variant="outline" onPress={() => setShowForm(true)} />
      )}
    </View>
  );
}
const s = StyleSheet.create({ form:{ gap:8, marginTop:8 }, inp:{ borderWidth:1, borderColor:'#ddd', borderRadius:8, padding:10, backgroundColor:RenovaTheme.colors.surface }, box:{ marginVertical:10 }, head:{ fontWeight:'800', marginBottom:8 }, row:{ backgroundColor:RenovaTheme.colors.surface, padding:10, borderRadius:8, marginBottom:6 }, n:{ fontWeight:'600' }, m:{ fontSize:12, color:'#666' }, link:{ color:'#2563eb', fontSize:12, marginTop:4 } });
