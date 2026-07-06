/** Материалы — потребности, закупки, чеки */
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, Pressable } from 'react-native';
import { useFocusEffect, usePathname } from 'expo-router';
import { RenovaTheme, card } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { MaterialPickList } from '@/components/renova/MaterialPickList';
import { MaterialReceiptReconcile } from '@/components/renova/MaterialReceiptReconcile';
import { PurchaseList } from '@/components/renova/PurchaseList';
import { useRenova } from '@/lib/context/RenovaContext';
import { api, MaterialPick, Purchase, ReceiptItem } from '@/lib/api';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { screenLayout } from '@/constants/screenLayout';

const FILTERS = [
  { key: 'all', label: 'Все' },
  { key: 'buy', label: 'Купить' },
  { key: 'ordered', label: 'Согласовано' },
  { key: 'delivered', label: 'В факте' },
  { key: 'shortage', label: 'Не хватает' },
];

export function OsMaterialsScreen({ role }: { role: import('@/constants/osSections').OsRole }) {
  const pathname = usePathname();
  const { user, activeProject, readOnly } = useRenova();
  const [picks, setPicks] = useState<MaterialPick[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    if (!user || !activeProject) return;
    api.listMaterialPicks(user.id, activeProject.id).then(setPicks).catch(() => setPicks([]));
    api.listPurchases(user.id, activeProject.id).then(setPurchases).catch(() => setPurchases([]));
    api.listReceipts(user.id, activeProject.id).then(setReceipts).catch(() => setReceipts([]));
  }, [user?.id, activeProject?.id]);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const filteredPicks = useMemo(() => {
    return picks.filter((p) => {
      if (filter === 'buy') return p.status === 'draft' || p.status === 'pending';
      if (filter === 'ordered') return p.status === 'approved';
      if (filter === 'delivered') return p.status === 'purchased';
      if (filter === 'shortage') return (p.qty_needed || p.qty) > (p.qty_delivered || 0);
      return true;
    });
  }, [picks, filter]);

  if (!activeProject || !user) return <ProjectEmptyState role={role} />;

  const needBuy = picks.filter((p) => p.status === 'draft' || p.status === 'pending').length;
  const ordered = picks.filter((p) => p.status === 'approved').length;
  const delivered = picks.filter((p) => p.status === 'purchased').length;
  const shortage = picks.filter((p) => (p.qty_needed || p.qty) > (p.qty_delivered || 0) && p.status !== 'purchased').length;

  const createPurchaseFromDrafts = async () => {
    const ids = picks.filter((p) => p.status === 'draft' || p.status === 'pending').map((p) => p.id);
    if (!ids.length) return;
    setBusy(true);
    try {
      await api.createPurchase(user.id, activeProject.id, ids);
      reload();
    } finally {
      setBusy(false);
    }
  };

  const generateFromEstimate = async () => {
    setBusy(true);
    try {
      await api.generateMaterialNeeds(user.id, activeProject.id);
      reload();
    } finally {
      setBusy(false);
    }
  };

  const advancePurchase = async (id: string, status: string) => {
    await api.updatePurchaseStatus(user.id, activeProject.id, id, status);
    reload();
  };

  return (
    <ScrollView style={s.wrap} contentContainerStyle={screenLayout.contentStyle}>
      <View style={s.summary}>
        <View style={s.cell}><Text style={s.n}>{needBuy}</Text><Text style={s.l}>Купить</Text></View>
        <View style={s.cell}><Text style={s.n}>{ordered}</Text><Text style={s.l}>Согласовано</Text></View>
        <View style={s.cell}><Text style={s.n}>{delivered}</Text><Text style={s.l}>В факте</Text></View>
        <View style={[s.cell, shortage > 0 && s.cellWarn]}><Text style={s.n}>{shortage}</Text><Text style={s.l}>Не хватает</Text></View>
      </View>
      <Text style={s.factHint}>
        В факт бюджета попадает только «В факте» (куплено). «Согласовано» — ещё не трата. Убрать из факта — «Убрать из факта» в закупке.
      </Text>

      {!readOnly && (
        <View style={s.actions}>
          {needBuy > 0 && <PrimaryButton title="Создать закупку" onPress={createPurchaseFromDrafts} disabled={busy} />}
          <PrimaryButton title="Из сметы" variant="outline" onPress={generateFromEstimate} disabled={busy} />
          <Text style={s.fabHint}>Расход по чеку — кнопка «+» внизу экрана</Text>
        </View>
      )}

      {!picks.length && (
        <View style={s.empty}>
          <Text style={s.emptyT}>Материалы ещё не рассчитаны</Text>
          <Text style={s.emptyM}>Добавьте размеры комнат или сформируйте список из сметы</Text>
          {!readOnly && <PrimaryButton title="Рассчитать из сметы" onPress={generateFromEstimate} />}
        </View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chips}>
        {FILTERS.map((f) => (
          <Pressable key={f.key} style={[s.chip, filter === f.key && s.chipOn]} onPress={() => setFilter(f.key)}>
            <Text style={[s.chipT, filter === f.key && s.chipTOn]}>{f.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <PurchaseList purchases={purchases} readOnly={readOnly} returnTo={pathname} onAdvance={advancePurchase} />
      <MaterialPickList
        userId={user.id}
        projectId={activeProject.id}
        role={role}
        rooms={activeProject.rooms || []}
        stages={activeProject.stages || []}
        picksOverride={filteredPicks}
        readOnly={readOnly}
      />
      <MaterialReceiptReconcile rooms={activeProject.rooms || []} picks={picks} receipts={receipts} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  cell: { ...card, width: '47%', alignItems: 'center', marginBottom: 0, paddingVertical: 12 },
  cellWarn: { borderColor: '#D4A574', backgroundColor: '#FFFBF5' },
  n: { fontSize: 22, fontWeight: '800', color: RenovaTheme.colors.text },
  l: { fontSize: 12, color: RenovaTheme.colors.textMuted },
  actions: { gap: 8, marginBottom: 12 },
  fabHint: { fontSize: 12, color: RenovaTheme.colors.textMuted, textAlign: 'center' },
  factHint: { fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 17, marginBottom: 12 },
  empty: { ...card, marginBottom: 12 },
  emptyT: { fontWeight: '700', fontSize: 15 },
  emptyM: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginVertical: 8, lineHeight: 18 },
  chips: { marginBottom: 8, maxHeight: 40 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: RenovaTheme.colors.border, marginRight: 8, backgroundColor: '#fff' },
  chipOn: { borderColor: RenovaTheme.colors.text, backgroundColor: RenovaTheme.colors.borderLight },
  chipT: { fontSize: 13, color: RenovaTheme.colors.textMuted },
  chipTOn: { color: RenovaTheme.colors.text, fontWeight: '600' },
});
