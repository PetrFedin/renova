/** Единая главная Renova OS — заказчик и исполнитель */
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { pushOsNav } from '@/lib/pushOsNav';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { type BudgetAlert } from '@/components/renova/BudgetAlerts';
import { HomeScreenBody } from '@/components/renova/os/home/HomeScreenBody';
import { homeLayout } from '@/constants/homeTypography';
import { useHomeWidgets } from '@/lib/useHomeWidgets';
import { useDetailLevel } from '@/lib/useDetailLevel';
import { homeWidgetVisibleForLevel } from '@/lib/detailLevelPolicy';
import type { HomeWidgetId } from '@/constants/homeWidgets';
import { useRenova } from '@/lib/context/RenovaContext';
import { buildProjectOsSnapshot } from '@/lib/domain/buildProjectOsSnapshot';
import { buildHomeMoreSummary, homeMoreHasVisibleContent } from '@/lib/domain/buildHomeMoreSummary';
import { formatProjectHeaderMeta } from '@/lib/domain/resolveProjectPhase';
import { buildHomeSearchHints } from '@/lib/domain/buildHomeSearchHints';
import { clearHomeSearchHints, setHomeSearchHints } from '@/lib/homeSearchHints';
import { fallbackDashboard } from '@/lib/domain/fallbackDashboard';
import { api, Dashboard, ReceiptItem, MaterialPick, Purchase, OsRisk, OsScheduleSummary, OsInsight, OsBudgetSummary } from '@/lib/api';
import type { OsRole } from '@/constants/osSections';
import { IntegrationHonestyBadge } from '@/components/renova/IntegrationHonestyBadge';
import { getOfflineOutboxStatus, subscribeOfflineFlush } from '@/lib/offline';
import { mergeDigestInsight } from '@/lib/domain/digestHomeInsight';
import { subscribeProjectDataChanged } from '@/lib/projectDataBus';
import { reportCatch } from '@/lib/reportError';

export function OsHomeScreen({ role }: { role: OsRole }) {
  const { user, activeProject, projects, readOnly, refreshProjects, loadProject, projectResolving, loading: ctxLoading } = useRenova();
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
  const [picks, setPicks] = useState<MaterialPick[]>([]);
  const [apiRisks, setApiRisks] = useState<OsRisk[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [osSchedule, setOsSchedule] = useState<OsScheduleSummary | null>(null);
  const [insights, setInsights] = useState<OsInsight[]>([]);
  const [budgetAlerts, setBudgetAlerts] = useState<BudgetAlert[]>([]);
  const [osBudget, setOsBudget] = useState<OsBudgetSummary | null>(null);
  const [pendingAcceptance, setPendingAcceptance] = useState(0);
  const [pendingPayments, setPendingPayments] = useState(0);
  const [pendingPaymentTotal, setPendingPaymentTotal] = useState(0);
  /** W55/W76: подсказки nextAction (график, гарантия, ДО, подписи) */
  const [workScheduleStatus, setWorkScheduleStatus] = useState<string | null>(null);
  const [warrantyOpen, setWarrantyOpen] = useState(0);
  const [warrantyOverdue, setWarrantyOverdue] = useState(0);
  const [pendingChangeOrders, setPendingChangeOrders] = useState(0);
  const [pendingSignDocs, setPendingSignDocs] = useState(0);
  const [offlinePending, setOfflinePending] = useState(0);
  const [offlineBlocked, setOfflineBlocked] = useState(0);
  const [closeoutReady, setCloseoutReady] = useState(false);
  const [closeoutArchived, setCloseoutArchived] = useState(false);
  const [closeoutNext, setCloseoutNext] = useState<string | null>(null);
  const [closeoutAllStagesDone, setCloseoutAllStagesDone] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const snapRole = readOnly ? 'customer' : role === 'contractor' ? 'contractor' : 'customer';
  const { isVisible: isWidgetEnabled } = useHomeWidgets(role);
  const detailLevel = useDetailLevel();
  const isVisible = (id: HomeWidgetId) => isWidgetEnabled(id) && homeWidgetVisibleForLevel(id, detailLevel);

  async function load() {
    if (!user || !activeProject) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      try {
        setDash(await api.dashboard(user.id, activeProject.id));
      } catch {
        setDash(fallbackDashboard(activeProject));
      }

      // W65: pending payments для обеих ролей (заказчик платит, исполнитель ждёт)
      try {
        const items = await api.listPayments(user.id, activeProject.id);
        const pending = items.filter((p) => p.status === 'pending');
        setPendingPayments(pending.length);
        setPendingPaymentTotal(pending.reduce((sum, p) => sum + p.amount, 0));
      } catch {
        setPendingPayments(0);
        setPendingPaymentTotal(0);
      }

      const results = await Promise.allSettled([
        api.listReceipts(user.id, activeProject.id).then(setReceipts),
        api.listMaterialPicks(user.id, activeProject.id).then(setPicks),
        api.listPurchases(user.id, activeProject.id).then(setPurchases),
        api.osRisks(user.id, activeProject.id).then((r) => setApiRisks(r.items)),
        api.osSchedule(user.id, activeProject.id).then(setOsSchedule),
        api.osInsights(user.id, activeProject.id).then(async (r) => {
          let items = r.items || [];
          try {
            const dig = await api.previewWeeklyDigest(user.id, activeProject.id);
            items = mergeDigestInsight(items, dig);
          } catch { /* noop */ }
          setInsights(items);
        }),
        api.budgetAlerts(user.id, activeProject.id).then(setBudgetAlerts),
        api.osBudget(user.id, activeProject.id).then(setOsBudget),
        api.acceptancesPendingCount(user.id, activeProject.id).then((r) => setPendingAcceptance(r.count)),
        api.getActiveWorkSchedule(user.id, activeProject.id).then((s) => setWorkScheduleStatus(s?.status ?? null)),
        // W76: гарантия / ДО / черновики подписи → nextAction
        api.listWarrantyClaims(user.id, activeProject.id).then((r) => {
          setWarrantyOpen(r.open ?? 0);
          setWarrantyOverdue(r.overdue ?? 0);
        }),
        api.listChangeOrders(user.id, activeProject.id).then((orders) => {
          setPendingChangeOrders(orders.filter((o) => o.status === 'pending').length);
        }),
        api.listProjectDocuments(user.id, activeProject.id).then((res) => {
          setPendingSignDocs((res.items || []).filter((d) => d.status === 'draft').length);
        }),
        getOfflineOutboxStatus().then((st) => {
          setOfflinePending(st.pending || 0);
          setOfflineBlocked((st.blocked || 0) + (st.conflicts || 0));
        }),
        api.closeoutChecklist(user.id, activeProject.id).then((cl) => {
          setCloseoutReady(Boolean(cl.ready));
          setCloseoutArchived(Boolean(cl.archived));
          setCloseoutNext(cl.next_action || null);
          setCloseoutAllStagesDone(Boolean(cl.all_stages_done));
        }),
      ]);
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          const fallbacks = [
            () => setReceipts([]),
            () => setPicks([]),
            () => setPurchases([]),
            () => setApiRisks([]),
            () => setOsSchedule(null),
            () => setInsights([]),
            () => setBudgetAlerts([]),
            () => setOsBudget(null),
            () => setPendingAcceptance(0),
            () => setWorkScheduleStatus(null),
            () => { setWarrantyOpen(0); setWarrantyOverdue(0); },
            () => setPendingChangeOrders(0),
            () => setPendingSignDocs(0),
            () => { setOfflinePending(0); setOfflineBlocked(0); },
            () => {
              setCloseoutReady(false);
              setCloseoutArchived(false);
              setCloseoutNext(null);
              setCloseoutAllStagesDone(false);
            },
          ];
          fallbacks[i]?.();
        }
      });
    } catch (e) {
      setLoadError('Не удалось загрузить данные главной');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); refreshProjects().catch(reportCatch('components.screens.OsHomeScreen.1')); }, [user?.id, activeProject?.id]);

  // W79: после sync offline — обновить счётчики hero без полного reload проекта
  useEffect(() => subscribeOfflineFlush(() => {
    getOfflineOutboxStatus()
      .then((st) => {
        setOfflinePending(st.pending || 0);
        setOfflineBlocked((st.blocked || 0) + (st.conflicts || 0));
      })
      .catch(reportCatch('components.screens.OsHomeScreen.2'));
  }), []);

  // W81: график/объект изменились → обновить nextAction (submitted → confirmed)
  useEffect(() => subscribeProjectDataChanged(() => {
    load().catch(reportCatch('components.screens.OsHomeScreen.3'));
  }), [user?.id, activeProject?.id]);

  const snap = useMemo(() => {
    if (!activeProject || !dash) return null;
    return buildProjectOsSnapshot(
      activeProject,
      dash,
      receipts,
      picks,
      purchases,
      apiRisks,
      osSchedule,
      snapRole as any,
      osBudget,
      pendingAcceptance || dash.pending_acceptances || 0,
      pendingPayments,
      pendingPaymentTotal,
      { status: workScheduleStatus, warrantyOpen, warrantyOverdue, pendingChangeOrders, pendingSignDocs, offlinePending, offlineBlocked,
        closeoutReady, closeoutArchived, closeoutNext, closeoutAllStagesDone },
    );
  }, [
    activeProject, dash, receipts, picks, purchases, apiRisks, osSchedule, snapRole, osBudget,
    pendingAcceptance, pendingPayments, pendingPaymentTotal, workScheduleStatus,
    warrantyOpen, warrantyOverdue, pendingChangeOrders, pendingSignDocs,
    offlinePending, offlineBlocked,
    closeoutReady, closeoutArchived, closeoutNext, closeoutAllStagesDone,
  ]);

  useEffect(() => {
    if (!snap) {
      clearHomeSearchHints();
      return;
    }
    setHomeSearchHints(buildHomeSearchHints(snap));
    return () => clearHomeSearchHints();
  }, [snap]);

  async function onRefresh() {
    setRefreshing(true);
    try { await refreshProjects(); if (activeProject) await loadProject(activeProject.id); await load(); } finally { setRefreshing(false); }
  }

  const showAttention = isVisible('health_next') || isVisible('inbox') || isVisible('insights');
  const showKpi = (['kpi_budget', 'kpi_schedule', 'kpi_materials', 'kpi_quality'] as const).some((id) => isVisible(id));

  if (!user) return null;

  if (role === 'contractor' && projects.length === 0) {
    return (
      <ScrollView style={s.container} contentContainerStyle={s.content}>
        <Text style={s.emptyTitle}>Нет объектов</Text>
        <PrimaryButton title="Заявки и новые объекты" onPress={() => pushOsNav('/job-leads', undefined, role)} />
      </ScrollView>
    );
  }

  if (!activeProject) {
    if (projects.length > 0 && (projectResolving || ctxLoading)) {
      return (
        <View style={s.center}>
          <ActivityIndicator color={RenovaTheme.colors.primary} />
          <Text style={s.hint}>Загрузка объекта…</Text>
        </View>
      );
    }
    return (
      <ProjectEmptyState
        role={role}
        showCreate
        hideHomeButton
      />
    );
  }

  if (loading && !dash) {
    return <View style={s.center}><ActivityIndicator color={RenovaTheme.colors.primary} /></View>;
  }

  if (!dash || !snap) {
    return (
      <ScrollView style={s.container} contentContainerStyle={s.content}>
        <Text style={s.emptyTitle}>Не удалось загрузить главную</Text>
        {loadError ? <Text style={s.hint}>{loadError}</Text> : null}
        <PrimaryButton title="Повторить" onPress={() => load().catch(reportCatch('components.screens.OsHomeScreen.4'))} />
      </ScrollView>
    );
  }

  const headerMeta = formatProjectHeaderMeta(
    activeProject.property_type,
    activeProject.rooms?.length || 0,
    activeProject.address,
    snap,
  );

  const showWorksMaterials = isVisible('works_materials') && !snap.isComplete;
  const moreArgs = {
    snap,
    project: activeProject,
    budgetAlerts,
    receipts,
    picks,
    isVisible,
  };
  const moreSummary = buildHomeMoreSummary(moreArgs);
  const moreHasContent = homeMoreHasVisibleContent(moreArgs);

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <IntegrationHonestyBadge />
        <HomeScreenBody
        role={role}
        user={user}
        activeProject={activeProject}
        projectsCount={projects.length}
        snap={snap}
        headerMeta={headerMeta}
        readOnly={readOnly}
        insights={insights}
        budgetAlerts={budgetAlerts}
        receipts={receipts}
        picks={picks}
        moreSummary={moreSummary}
        moreHasContent={moreHasContent}
        showWorksMaterials={showWorksMaterials}
        showAttention={showAttention}
        showKpi={showKpi}
        isVisible={isVisible}
      />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  content: { padding: homeLayout.screenPadding, paddingBottom: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: RenovaTheme.colors.background },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: RenovaTheme.colors.text, marginBottom: 12 },
  hint: { fontSize: 13, color: RenovaTheme.colors.warning, marginBottom: 10 },
});
