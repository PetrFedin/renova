/** Материалы — hub: Потребности · Закупки · Чеки */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, Pressable } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams, usePathname } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import { screenTypography, listRowStyles, filterChipStyles } from '@/constants/screenTypography';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { MaterialPickList } from '@/components/renova/MaterialPickList';
import { MaterialReceiptReconcile } from '@/components/renova/MaterialReceiptReconcile';
import { PurchaseList } from '@/components/renova/PurchaseList';
import { OsHubTabs, type HubTab } from '@/components/renova/os/OsHubTabs';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { api, type MaterialPick, type Purchase, type ReceiptItem } from '@/lib/api';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { screenLayout } from '@/constants/screenLayout';
import { procurementNextAction, readyPickIds } from '@/lib/domain/procurementNextAction';
import { repairTabRoute } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { alertPurchaseCreated, alertPurchaseAdvanced } from '@/lib/procurementNav';

const PICK_FILTERS = [
  { key: 'all', label: 'Все' },
  { key: 'buy', label: 'Купить' },
  { key: 'ordered', label: 'Согласовано' },
  { key: 'delivered', label: 'В факте' },
  { key: 'shortage', label: 'Не хватает' },
] as const;

type PickFilter = (typeof PICK_FILTERS)[number]['key'];
const SUBTAB_IDS = ['picks', 'purchases', 'receipts'] as const;
type MaterialSubtab = (typeof SUBTAB_IDS)[number];

function isMaterialSubtab(value: string | undefined): value is MaterialSubtab {
  return Boolean(value && (SUBTAB_IDS as readonly string[]).includes(value));
}

export function OsMaterialsScreen({ role }: { role: import('@/constants/osSections').OsRole }) {
  const pathname = usePathname();
  const { subtab: subtabParam } = useLocalSearchParams<{ subtab?: string }>();
  const { user, activeProject, readOnly } = useRenova();
  const [picks, setPicks] = useState<MaterialPick[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
  const [filter, setFilter] = useState<PickFilter>('all');
  const [mutationKey, setMutationKey] = useState<string | null>(null);
  const mutationRef = useRef(false);
  const [subtab, setSubtab] = useState<MaterialSubtab>('picks');
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const busy = mutationKey !== null;

  useEffect(() => {
    const incoming = typeof subtabParam === 'string' ? subtabParam : undefined;
    if (isMaterialSubtab(incoming)) setSubtab(incoming);
  }, [subtabParam]);

  const setMaterialSubtab = useCallback((tab: MaterialSubtab) => {
    setSubtab(tab);
    router.setParams({ tab: 'materials', subtab: tab });
  }, []);

  const reload = useCallback(async () => {
    if (!user || !activeProject) return;
    setLoadState('loading');
    try {
      const [pickRows, purchaseRows, receiptRows] = await Promise.all([
        api.listMaterialPicks(user.id, activeProject.id),
        api.listPurchases(user.id, activeProject.id),
        api.listReceipts(user.id, activeProject.id),
      ]);
      setPicks(pickRows);
      setPurchases(purchaseRows);
      setReceipts(receiptRows);
      setLoadState('loaded');
    } catch {
      setLoadState('error');
    }
  }, [user?.id, activeProject?.id]);

  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  useProjectDataReload(reload);

  const runMutation = useCallback(async (key: string, task: () => Promise<void>) => {
    if (mutationRef.current) return;
    mutationRef.current = true;
    setMutationKey(key);
    try {
      await task();
    } finally {
      mutationRef.current = false;
      setMutationKey(null);
    }
  }, []);

  const filteredPicks = useMemo(() => picks.filter((pick) => {
    if (filter === 'buy') return pick.status === 'draft' || pick.status === 'pending';
    if (filter === 'ordered') return pick.status === 'approved';
    if (filter === 'delivered') return pick.status === 'purchased';
    if (filter === 'shortage') return (pick.qty_needed || pick.qty) > (pick.qty_delivered || 0);
    return true;
  }), [picks, filter]);

  if (!activeProject || !user) return <ProjectEmptyState role={role} />;

  if (loadState === 'error') {
    return (
      <View style={[screenLayout.screen, { padding: 16 }]}>
        <LoadErrorState
          title="Не удалось загрузить материалы"
          hint="Данные не загружены — это не «ноль закупок». Проверьте сеть и повторите."
          onRetry={() => { void reload(); }}
          role={role}
        />
      </View>
    );
  }

  const needBuy = picks.filter((pick) => pick.status === 'draft' || pick.status === 'pending').length;
  const ordered = picks.filter((pick) => pick.status === 'approved').length;
  const delivered = picks.filter((pick) => pick.status === 'purchased').length;
  const shortage = picks.filter((pick) => (pick.qty_needed || pick.qty) > (pick.qty_delivered || 0) && pick.status !== 'purchased').length;
  const openPurchases = purchases.filter((purchase) => purchase.status !== 'delivered' && purchase.status !== 'cancelled').length;
  const unverifiedReceipts = receipts.filter((receipt) => !receipt.verified).length;
  const readyCount = readyPickIds(picks, purchases).length;
  const next = procurementNextAction(picks, purchases, receipts);
  const nextNeedsWrite = next.id === 'generate' || next.id === 'create_purchase';

  const hubTabs: HubTab[] = [
    { id: 'picks', label: 'Потребности', badge: needBuy || undefined },
    { id: 'purchases', label: 'Закупки', badge: openPurchases || undefined },
    { id: 'receipts', label: 'Чеки', badge: unverifiedReceipts || undefined },
  ];

  const generateFromEstimate = async () => {
    if (readOnly) return;
    await runMutation('generate', async () => {
      await api.generateMaterialNeeds(user.id, activeProject.id);
      await reload();
    });
  };

  const createPurchaseFromReady = async () => {
    if (readOnly) return;
    const ids = readyPickIds(picks, purchases);
    if (!ids.length) return;
    await runMutation('create_purchase', async () => {
      await api.createPurchase(user.id, activeProject.id, ids);
      await syncProjectSideEffects({ user, project: activeProject });
      await reload();
      setMaterialSubtab('purchases');
      alertPurchaseCreated(role, ids.length);
    });
  };

  const runNextCta = async () => {
    if (next.id === 'generate') return generateFromEstimate();
    if (next.id === 'create_purchase') return createPurchaseFromReady();
    if (next.id === 'scan_receipt') {
      pushOsNav('/scan-receipt', pathname, role);
      return;
    }
    if (next.id === 'done') {
      await reload();
      return;
    }
    setMaterialSubtab(next.subtab);
  };

  const advancePurchase = (id: string, status: string) => {
    if (readOnly || mutationRef.current) return;
    const key = `purchase:${id}:${status}`;
    const run = () => runMutation(key, async () => {
      try {
        await api.updatePurchaseStatus(user.id, activeProject.id, id, status);
        await syncProjectSideEffects({ user, project: activeProject });
        await reload();
        alertPurchaseAdvanced(role, status);
      } catch {
        showActionConfirm({
          title: 'Не удалось обновить закупку',
          message: 'Статус не изменён. Проверьте сеть и повторите.',
        });
      }
    });

    if (status === 'cancelled') {
      showActionConfirm({
        title: 'Убрать из факта?',
        message: 'Сумма закупки выйдет из факта бюджета. Позиции и история закупки сохранятся.',
        primaryLabel: 'Убрать',
        primaryDestructive: true,
        onPrimary: () => { void run(); },
        secondaryLabel: 'Отмена',
        onSecondary: () => undefined,
      });
      return;
    }
    void run();
  };

  return (
    <View style={s.root}>
      <ScrollView style={s.body} contentContainerStyle={screenLayout.contentStyle}>
        <View style={s.summary}>
          <View style={s.cell}>
            <Text style={s.n}>{needBuy}</Text>
            <Text style={s.l}>Нужно купить</Text>
          </View>
          <View style={s.cell}>
            <Text style={s.n}>{delivered}</Text>
            <Text style={s.l}>В факте</Text>
          </View>
        </View>
        <Text style={[s.factHint, shortage > 0 && { color: RenovaTheme.colors.warningText }]}>
          {shortage > 0 ? `Не хватает: ${shortage} · ` : ''}Согласовано: {ordered} · открытых закупок: {openPurchases}
        </Text>

        <View style={s.nextBox}>
          <Text style={s.nextLabel}>Следующий шаг</Text>
          <Text style={s.nextTitle}>{next.title}</Text>
          {!nextNeedsWrite || !readOnly ? (
            <PrimaryButton
              title={next.cta}
              loading={mutationKey === next.id}
              disabled={busy && mutationKey !== next.id}
              onPress={() => { void runNextCta(); }}
              fullWidth
            />
          ) : null}
          {role === 'contractor' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Открыть подбор чистовых материалов"
              style={s.secondaryLink}
              disabled={busy}
              onPress={() => pushOsNav(repairTabRoute(role, 'selections'), pathname)}
            >
              <Text style={s.secondaryLinkText}>Подбор чистовых →</Text>
            </Pressable>
          ) : null}
        </View>

        <OsHubTabs tabs={hubTabs} value={subtab} onChange={(id) => setMaterialSubtab(id as MaterialSubtab)} />

        {subtab === 'picks' ? (
          <>
            {!picks.length ? (
              <View style={s.empty}>
                <Text style={s.emptyT}>Материалы ещё не рассчитаны</Text>
                <Text style={s.emptyM}>Следующий шаг выше сформирует потребности из сметы.</Text>
              </View>
            ) : null}
            {picks.length ? (
              <View style={filterChipStyles.row}>
                {PICK_FILTERS.map((item) => {
                  const selected = filter === item.key;
                  return (
                    <Pressable
                      key={item.key}
                      accessibilityRole="button"
                      accessibilityLabel={`Фильтр материалов: ${item.label}`}
                      accessibilityState={{ selected, disabled: busy }}
                      style={[filterChipStyles.chip, s.chipTouch, selected && filterChipStyles.chipOn]}
                      disabled={busy}
                      onPress={() => setFilter(item.key)}
                    >
                      <Text style={[filterChipStyles.chipT, selected && filterChipStyles.chipTOn]}>{item.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            <MaterialPickList
              userId={user.id}
              projectId={activeProject.id}
              role={role}
              rooms={activeProject.rooms || []}
              stages={activeProject.stages || []}
              picksOverride={filteredPicks}
              readOnly={readOnly || busy}
            />
          </>
        ) : null}

        {subtab === 'purchases' ? (
          <>
            {!purchases.length ? (
              <View style={s.empty}>
                <Text style={s.emptyT}>Закупок пока нет</Text>
                <Text style={s.emptyM}>
                  {readyCount > 0
                    ? `Следующий шаг выше создаст закупку из ${readyCount} согласованных позиций.`
                    : 'Согласуйте материалы на вкладке «Потребности».'}
                </Text>
              </View>
            ) : null}
            <PurchaseList
              purchases={purchases}
              readOnly={readOnly}
              returnTo={pathname}
              mutationKey={mutationKey}
              onAdvance={advancePurchase}
            />
          </>
        ) : null}

        {subtab === 'receipts' ? (
          <>
            <PrimaryButton
              title="Сканировать QR чека"
              variant="outline"
              disabled={busy}
              onPress={() => pushOsNav('/scan-receipt', pathname, role)}
            />
            <Text style={s.factHint}>После скана сверьте чек с закупкой. В факт попадают доставленные закупки и подтверждённые чеки.</Text>
            <MaterialReceiptReconcile rooms={activeProject.rooms || []} picks={picks} receipts={receipts} />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  body: { flex: 1 },
  summary: { ...listRowStyles.summaryRow, marginBottom: 4 },
  cell: { ...listRowStyles.metricCell, marginBottom: 0 },
  n: { ...screenTypography.metric },
  l: { ...screenTypography.metricLabel },
  factHint: { ...screenTypography.listMeta, marginBottom: 10 },
  nextBox: {
    ...listRowStyles.metricCell,
    alignItems: 'stretch',
    marginBottom: 12,
    gap: 8,
    paddingHorizontal: 12,
  },
  nextLabel: { ...screenTypography.metricLabel },
  nextTitle: { ...screenTypography.listTitle, lineHeight: 20 },
  secondaryLink: { minHeight: RenovaTheme.minTouch, justifyContent: 'center', alignItems: 'center' },
  secondaryLinkText: { ...screenTypography.listLink, marginTop: 0 },
  empty: { ...listRowStyles.row, marginBottom: 12 },
  emptyT: { ...screenTypography.listTitle },
  emptyM: { ...screenTypography.empty, marginVertical: 8 },
  chipTouch: { minHeight: RenovaTheme.minTouch, justifyContent: 'center' },
});
