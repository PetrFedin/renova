/** Материалы — hub: Потребности · Закупки · Чеки (P1.7) */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, Pressable } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams, usePathname } from 'expo-router';
import { RenovaTheme, card } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { MaterialPickList } from '@/components/renova/MaterialPickList';
import { MaterialReceiptReconcile } from '@/components/renova/MaterialReceiptReconcile';
import { PurchaseList } from '@/components/renova/PurchaseList';
import { OsHubTabs, type HubTab } from '@/components/renova/os/OsHubTabs';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { api, MaterialPick, Purchase, ReceiptItem } from '@/lib/api';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { screenLayout } from '@/constants/screenLayout';
import { procurementNextAction, readyPickIds } from '@/lib/domain/procurementNextAction';
import { repairTabRoute } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';

const PICK_FILTERS = [
  { key: 'all', label: 'Все' },
  { key: 'buy', label: 'Купить' },
  { key: 'ordered', label: 'Согласовано' },
  { key: 'delivered', label: 'В факте' },
  { key: 'shortage', label: 'Не хватает' },
] as const;

const SUBTAB_IDS = ['picks', 'purchases', 'receipts'] as const;
type MaterialSubtab = (typeof SUBTAB_IDS)[number];

function isMaterialSubtab(v: string | undefined): v is MaterialSubtab {
  return !!v && (SUBTAB_IDS as readonly string[]).includes(v);
}

export function OsMaterialsScreen({ role }: { role: import('@/constants/osSections').OsRole }) {
  const pathname = usePathname();
  const { subtab: subtabParam } = useLocalSearchParams<{ subtab?: string }>();
  const { user, activeProject, readOnly } = useRenova();
  const [picks, setPicks] = useState<MaterialPick[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [subtab, setSubtab] = useState<MaterialSubtab>('picks');

  useEffect(() => {
    if (isMaterialSubtab(typeof subtabParam === 'string' ? subtabParam : undefined)) {
      setSubtab(subtabParam);
    }
  }, [subtabParam]);

  const setMaterialSubtab = useCallback((tab: MaterialSubtab) => {
    setSubtab(tab);
    router.setParams({ tab: 'materials', subtab: tab });
  }, []);

  const reload = useCallback(() => {
    if (!user || !activeProject) return;
    api.listMaterialPicks(user.id, activeProject.id).then(setPicks).catch(() => setPicks([]));
    api.listPurchases(user.id, activeProject.id).then(setPurchases).catch(() => setPurchases([]));
    api.listReceipts(user.id, activeProject.id).then(setReceipts).catch(() => setReceipts([]));
  }, [user?.id, activeProject?.id]);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  useProjectDataReload(reload);

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
  const openPurchases = purchases.filter((p) => p.status !== 'delivered' && p.status !== 'cancelled').length;
  const unlinkedReceipts = receipts.filter((r) => !r.verified).length;

  const hubTabs: HubTab[] = [
    { id: 'picks', label: 'Потребности', badge: needBuy || undefined },
    { id: 'purchases', label: 'Закупки', badge: openPurchases || undefined },
    { id: 'receipts', label: 'Чеки', badge: unlinkedReceipts || undefined },
  ];

  const generateFromEstimate = async () => {
    setBusy(true);
    try {
      await api.generateMaterialNeeds(user.id, activeProject.id);
      reload();
    } finally {
      setBusy(false);
    }
  };

  const createPurchaseFromReady = async () => {
    const ids = readyPickIds(picks, purchases);
    if (!ids.length) return;
    setBusy(true);
    try {
      await api.createPurchase(user.id, activeProject.id, ids);
      await syncProjectSideEffects({ user, project: activeProject });
      reload();
      setMaterialSubtab('purchases');
    } finally {
      setBusy(false);
    }
  };

  const next = procurementNextAction(picks, purchases, receipts);
  const readyCount = readyPickIds(picks, purchases).length;

  const runNextCta = async () => {
    if (next.id === 'generate') {
      await generateFromEstimate();
      return;
    }
    if (next.id === 'create_purchase') {
      await createPurchaseFromReady();
      return;
    }
    if (next.id === 'scan_receipt') {
      pushOsNav('/scan-receipt', pathname, role);
      return;
    }
    setMaterialSubtab(next.subtab);
  };

  const advancePurchase = async (id: string, status: string) => {
    await api.updatePurchaseStatus(user.id, activeProject.id, id, status);
    await syncProjectSideEffects({ user, project: activeProject });
    reload();
  };

  return (
    <View style={s.root}>
      <ScrollView style={s.wrap} contentContainerStyle={screenLayout.contentStyle}>
        <View style={s.summary}>
          <View style={s.cell}><Text style={s.n}>{needBuy}</Text><Text style={s.l}>Купить</Text></View>
          <View style={s.cell}><Text style={s.n}>{ordered}</Text><Text style={s.l}>Согласовано</Text></View>
          <View style={s.cell}><Text style={s.n}>{delivered}</Text><Text style={s.l}>В факте</Text></View>
          <View style={[s.cell, shortage > 0 && s.cellWarn]}><Text style={s.n}>{shortage}</Text><Text style={s.l}>Не хватает</Text></View>
        </View>
        <Text style={s.factHint}>
          Цепочка: потребность → закупка → чек. В факт бюджета попадает только «В факте» (куплено).
        </Text>
        <View style={s.nextBox}>
          <Text style={s.nextLabel}>Сейчас</Text>
          <Text style={s.nextTitle}>{next.title}</Text>
          {!readOnly || next.id === 'approve_picks' ? (
            <PrimaryButton title={busy ? '…' : next.cta} disabled={busy} onPress={() => { void runNextCta(); }} />
          ) : null}
          {role === 'contractor' ? (
            <PrimaryButton
              title="Подбор чистовых →"
              variant="outline"
              compact
              onPress={() => pushOsNav(repairTabRoute(role, 'selections'), pathname)}
            />
          ) : null}
        </View>
      </ScrollView>

      <OsHubTabs tabs={hubTabs} value={subtab} onChange={(id) => setMaterialSubtab(id as MaterialSubtab)} />

      <ScrollView style={s.body} contentContainerStyle={screenLayout.contentStyle}>
        {subtab === 'picks' && (
          <>
            {!readOnly && (
              <View style={s.actions}>
                {readyCount > 0 && <PrimaryButton title={`Создать закупку (${readyCount})`} onPress={createPurchaseFromReady} disabled={busy} />}
                <PrimaryButton title="Из сметы" variant="outline" onPress={generateFromEstimate} disabled={busy} />
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
              {PICK_FILTERS.map((f) => (
                <Pressable key={f.key} style={[s.chip, filter === f.key && s.chipOn]} onPress={() => setFilter(f.key)}>
                  <Text style={[s.chipT, filter === f.key && s.chipTOn]}>{f.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <MaterialPickList
              userId={user.id}
              projectId={activeProject.id}
              role={role}
              rooms={activeProject.rooms || []}
              stages={activeProject.stages || []}
              picksOverride={filteredPicks}
              readOnly={readOnly}
            />
          </>
        )}

        {subtab === 'purchases' && (
          <>
            {!readOnly && readyCount > 0 && (
              <PrimaryButton title={`Создать закупку (${readyCount})`} onPress={createPurchaseFromReady} disabled={busy} />
            )}
            {!purchases.length ? (
              <View style={s.empty}>
                <Text style={s.emptyT}>Закупок пока нет</Text>
                <Text style={s.emptyM}>Сформируйте закупку из потребностей или согласуйте позиции на вкладке «Потребности»</Text>
              </View>
            ) : null}
            <PurchaseList purchases={purchases} readOnly={readOnly} returnTo={pathname} onAdvance={advancePurchase} />
          </>
        )}

        {subtab === 'receipts' && (
          <>
            <PrimaryButton title="Сканировать QR чека" onPress={() => pushOsNav('/scan-receipt', pathname, role)} />
            <Text style={s.fabHint}>После скана сверка ниже. Факт бюджета — только по доставленным закупкам / верифицированным чекам.</Text>
            <MaterialReceiptReconcile rooms={activeProject.rooms || []} picks={picks} receipts={receipts} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  wrap: { flexGrow: 0 },
  body: { flex: 1 },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 },
  cell: { ...card, width: '47%', alignItems: 'center', marginBottom: 0, paddingVertical: 12 },
  cellWarn: { borderColor: '#D4A574', backgroundColor: '#FFFBF5' },
  n: { fontSize: 22, fontWeight: '800', color: RenovaTheme.colors.text },
  l: { fontSize: 12, color: RenovaTheme.colors.textMuted },
  actions: { gap: 8, marginBottom: 12 },
  fabHint: { fontSize: 12, color: RenovaTheme.colors.textMuted, textAlign: 'center', marginBottom: 12 },
  factHint: { fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 17, marginBottom: 4 },
  nextBox: { ...card, marginTop: 8, marginBottom: 4, gap: 8 },
  nextLabel: { fontSize: 11, fontWeight: '700', color: RenovaTheme.colors.textMuted, textTransform: 'uppercase' },
  nextTitle: { fontSize: 15, fontWeight: '700', color: RenovaTheme.colors.text, lineHeight: 20 },
  empty: { ...card, marginBottom: 12 },
  emptyT: { fontWeight: '700', fontSize: 15 },
  emptyM: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginVertical: 8, lineHeight: 18 },
  chips: { marginBottom: 8, maxHeight: 40 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: RenovaTheme.colors.border, marginRight: 8, backgroundColor: RenovaTheme.colors.surface },
  chipOn: { borderColor: RenovaTheme.colors.text, backgroundColor: RenovaTheme.colors.borderLight },
  chipT: { fontSize: 13, color: RenovaTheme.colors.textMuted },
  chipTOn: { color: RenovaTheme.colors.text, fontWeight: '600' },
});
