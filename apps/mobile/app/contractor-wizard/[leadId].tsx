/** Исполнитель: заявка → комнаты → проект с сметой */
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View, Text, TextInput, StyleSheet, Pressable, Alert } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { replaceOsNav } from '@/lib/pushOsNav';
import { tabsRoute } from '@/constants/osSections';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RoomTypePicker, FloorLevelPicker } from '@/components/renova/RoomTypePicker';
import { ROOM_PRESETS, resolveRenovationType, type WizardRoomDraft } from '@/constants/roomTypes';
import { calcRoomMetrics, generateTemplateLines, calcEstimateSummary } from '@/lib/calc-engine';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { api } from '@/lib/api';
import { BackHeader } from '@/components/renova/BackHeader';

export default function ContractorLeadWizard() {
  const { leadId, returnTo } = useLocalSearchParams<{ leadId: string; returnTo?: string }>();
  const { user, refreshProjects, loadProject } = useRenova();
  const [lead, setLead] = useState<any>(null);
  const [propertyType, setPropertyType] = useState<'apartment' | 'house'>('apartment');
  const [rooms, setRooms] = useState<WizardRoomDraft[]>([
    { name: 'Комната', room_type: 'living', floor_level: 1, length_m: 4, width_m: 3, height_m: 2.7, outlets_count: 4, switches_count: 1, plumbing_points: 0 },
  ]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user || !leadId) return;
    api.listJobLeads(user.id).then((items) => setLead(items.find((x) => x.id === leadId) || null)).catch(() => {});
  }, [user?.id, leadId]);

  const total = useMemo(() => {
    if (!lead) return 0;
    let sum = 0;
    rooms.forEach((room, i) => {
      const m = calcRoomMetrics({ lengthM: room.length_m, widthM: room.width_m, heightM: room.height_m, openingsSqM: 2 });
      const eff = resolveRenovationType(lead.renovation_type || 'cosmetic', room.room_type) as any;
      const lines = generateTemplateLines(eff, `t${i}`, m);
      sum += calcEstimateSummary(lines.materials, lines.works).grandTotal;
    });
    return sum;
  }, [lead, rooms]);

  async function onCreate() {
    if (!user || !leadId || !lead) return;
    setBusy(true);
    try {
      const r = await api.convertJobLead(user.id, leadId, { property_type: propertyType, rooms });
      await refreshProjects();
      if (r?.project_id) {
        await loadProject(r.project_id);
        await syncProjectSideEffects({ user, project: { id: r.project_id } as any });
      }
      replaceOsNav(tabsRoute('contractor', 'index'), undefined, 'contractor');
    } catch {
      Alert.alert('Ошибка', 'Не удалось создать проект');
    } finally {
      setBusy(false);
    }
  }

  if (!lead) return <View style={s.center}><Text>Загрузка заявки…</Text></View>;

  return (
    <>
      <BackHeader title="Новый объект из заявки" returnTo={returnTo} subtitle={lead.title} />
      <ScrollView style={s.wrap} contentContainerStyle={{ padding: 16 }}>
        <Text style={s.meta}>{lead.address || '—'} · {lead.renovation_type} · {lead.area_sqm || '?'} м²</Text>
        <View style={s.row}>
          {(['apartment', 'house'] as const).map((p) => (
            <Pressable key={p} style={[s.ptype, propertyType === p && s.ptypeOn]} onPress={() => setPropertyType(p)}>
              <Text style={propertyType === p ? s.ptypeTOn : s.ptypeT}>{p === 'apartment' ? 'Квартира' : 'Дом'}</Text>
            </Pressable>
          ))}
        </View>
        {rooms.map((r, i) => (
          <View key={i} style={s.card}>
            <TextInput style={s.inp} value={r.name} onChangeText={(name) => { const n = [...rooms]; n[i] = { ...r, name }; setRooms(n); }} />
            <RoomTypePicker value={r.room_type} onChange={(room_type) => { const n = [...rooms]; n[i] = { ...r, room_type }; setRooms(n); }} />
            {propertyType === 'house' && (
              <FloorLevelPicker value={r.floor_level ?? 1} onChange={(floor_level) => { const n = [...rooms]; n[i] = { ...r, floor_level }; setRooms(n); }} />
            )}
          </View>
        ))}
        <View style={s.templates}>
          {ROOM_PRESETS.map((tpl) => (
            <Pressable key={tpl.name} style={s.tpl} onPress={() => setRooms([...rooms, { ...tpl }])}>
              <Text style={s.tplT}>+ {tpl.name}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={s.total}>Оценка: {formatRub(total)}</Text>
        <PrimaryButton title={busy ? 'Создание…' : 'Создать проект'} onPress={onCreate} />
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  meta: { color: RenovaTheme.colors.textMuted, marginBottom: 12 },
  row: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  ptype: { flex: 1, padding: 10, borderRadius: 10, backgroundColor: RenovaTheme.colors.border, alignItems: 'center' },
  ptypeOn: { backgroundColor: RenovaTheme.colors.primary },
  ptypeT: { fontWeight: '700' },
  ptypeTOn: { fontWeight: '700', color: RenovaTheme.colors.surface },
  card: { backgroundColor: RenovaTheme.colors.surface, padding: 12, borderRadius: 10, marginBottom: 10 },
  inp: { borderWidth: 1, borderColor: RenovaTheme.colors.border, borderRadius: 8, padding: 10, marginBottom: 8 },
  templates: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  tpl: { backgroundColor: '#e0f2fe', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  tplT: { fontSize: 11, fontWeight: '600', color: '#0369a1' },
  total: { fontSize: 22, fontWeight: '800', color: RenovaTheme.colors.primary, marginVertical: 12 },
});
