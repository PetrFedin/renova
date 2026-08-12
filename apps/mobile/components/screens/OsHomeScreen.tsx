/** Единая главная Renova OS — заказчик и исполнитель */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { pushOsNav } from '@/lib/pushOsNav';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { type BudgetAlert } from '@/components/renova/BudgetAlerts';
import { HomeScreenBody } from '@/components/renova/os/home/HomeScreenBody';
import { InfoBanner } from '@/components/ui/InfoBanner';
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
import { reportCatch, reportError } from '@/lib/reportError';

const HOME_SOURCE_NAMES = [
  'receipts',
  'material_picks',
  'purchases',
  'risks',
  'schedule',
  'insights',
  'budget_alerts',
  'budget',
  'acceptances',
  'work_schedule',
  'warranty',
  'change_orders',
  'documents',
  'offline_queue',
  'closeout',
] as const;

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
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const loadedProjectIdRef = useRef<string | null>(null);
  const loadGenerationRef = useRef(0);

  const snapRole = readOnly ? 'customer' : role === 'contractor' ? 'contractor' : 'customer';
  const { isVisible: isWidgetEnabled } = useHomeWidgets(role);
  const detailLevel = useDetailLevel();
  const isVisible = (id: HomeWidgetId) => isWidgetEnabled(id) && homeWidgetVisibleForLevel(id, detailLevel);

  const resetProjectSnapshot = () => {
    setDash(null);
    setReceipts([]);
    setPicks([]);
    setApiRisks([]);
    setPurchases([]);
    setOsSchedule(null);
    setInsights([]);
    setBudgetAlerts([]);
    setOsBudget(null);
    setPendingAcceptance(0);
    setPendingPayments(0);
    setPendingPaymentTotal(0);
    setWorkScheduleStatus(null);
    setWarrantyOpen(0);
    setWarrantyOverdue(0);
    setPendingChangeOrders(0);
    setPendingSignDocs(0);
    setOfflinePending(0);
    setOfflineBlocked(0);
    setCloseoutReady(false);
    setCloseoutArchived(false);
    setCloseoutNext(null);
    setCloseoutAllStagesDone(false);
  };

  async function load() {
    const generation = ++loadGenerationRef.current;
    const isCurrentLoad = () => loadGenerationRef.current === generation;

    if (!user || !activeProject) {
      if (isCurrentLoad()) {
        loadedProjectIdRef.current = null;
        setLoading(false);
      }
      return;
    }

    const projectId = activeProject.id;
    const sameProject = loadedProjectIdRef.current === projectId;
    if (!sameProject && isCurrentLoad()) {
      loadedProjectIdRef.current = null;
      resetProjectSnapshot();
    }
    setLoading(true);
    setLoadError(null);
    setLoadWarning(null);
    const issues: string[] = [];

    try {
      try {
        const nextDashboard = await api.dashboard(user.id, projectId);
        if (!isCurrentLoad()) return;
        setDash(nextDashboard);
      } catch (error) {
        if (!isCurrentLoad()) return;
        reportError('home.dashboard', error, { userId: user.id, projectId });
        issues.push('dashboard');
        // A same-project refresh keeps the last confirmed dashboard. On first load,
        // project-only fallback keeps navigation usable but is explicitly degraded.
        if (!sameProject) setDash(fallbackDashboard(activeProject));
      }

      // W65: pending payments для обеих ролей (заказчик платит, исполнитель ждёт)
      try {
        const items = await api.listPayments(user.id, projectId);
        if (!isCurrentLoad()) return;
        const pending = items.filter((p) => p.status === 'pending');
        setPendingPayments(pending.length);
        setPendingPaymentTotal(pending.reduce((sum, p) => sum + p.amount, 0));
      } catch (error) {
        if (!isCurrentLoad()) return;
        reportError('home.pendingPayments', error, { userId: user.id, projectId });
        issues.push('payments');
        // Preserve last confirmed same-project values. A zero after source failure is not fact.
      }

      const results = await Promise.allSettled([
        api.listReceipts(user.id, projectId).then((value) => { if (isCurrentLoad()) setReceipts(value); return value; }),
        api.listMaterialPicks(user.id, projectId).then((value) => { if (isCurrentLoad()) setPicks(value); return value; }),
        api.listPurchases(user.id, projectId).then((value) => { if (isCurrentLoad()) setPurchases(value); return value; }),
        api.osRisks(user.id, projectId).then((value) => { if (isCurrentLoad()) setApiRisks(value.items); return value; }),
        api.osSchedule(user.id, projectId).then((value) => { if (isCurrentLoad()) setOsSchedule(value); return value; }),
        api.osInsights(user.id, projectId).then(async (r) => {
          let items = r.items || [];
          try {
            const dig = await api.previewWeeklyDigest(user.id, projectId);
            items = mergeDigestInsight(items, dig);
          } catch (error) {
            reportError('home.weeklyDigest', error, { userId: user.id, projectId });
            issues.push('weekly_digest');
          }
          if (isCurrentLoad()) setInsights(items);
          return items;
        }),
        api.budgetAlerts(user.id, projectId).then((value) => { if (isCurrentLoad()) setBudgetAlerts(value); return value; }),
        api.osBudget(user.id, projectId).then((value) => { if (isCurrentLoad()) setOsBudget(value); return value; }),
        api.acceptancesPendingCount(user.id, projectId).then((value) => { if (isCurrentLoad()) setPendingAcceptance(value.count); return value; }),
        api.getActiveWorkSchedule(user.id, projectId).then((value) => { if (isCurrentLoad()) setWorkScheduleStatus(value?.status ?? null); return value; }),
        // W76: гарантия / ДО / черновики подписи → nextAction
        api.listWarrantyClaims(user.id, projectId).then((value) => {
          if (isCurrentLoad()) {
            setWarrantyOpen(value.open ?? 0);
            setWarrantyOverdue(value.overdue ?? 0);
          }
          return value;
        }),
        api.listChangeOrders(user.id, projectId).then((orders) => {
          if (isCurrentLoad()) setPendingChangeOrders(orders.filter((o) => o.status === 'pending').length);
          return orders;
        }),
        api.listProjectDocuments(user.id, projectId).then((res) => {
          if (isCurrentLoad()) setPendingSignDocs((res.items || []).filter((d) => d.status === 'draft').length);
          return res;
        }),
        getOfflineOutboxStatus().then((st) => {
          if (isCurrentLoad()) {
            setOfflinePending(st.pending || 0);
            setOfflineBlocked((st.blocked || 0) + (st.conflicts || 0));
          }
          return st;
        }),
        api.closeoutChecklist(user.id, projectId).then((cl) => {
          if (isCurrentLoad()) {
            setCloseoutReady(Boolean(cl.ready));
            setCloseoutArchived(Boolean(cl.archived));
            setCloseoutNext(cl.next_action || null);
            setCloseoutAllStagesDone(Boolean(cl.all_stages_done));
          }
          return cl;
        }),
      ]);

      if (!isCurrentLoad()) return;
      results.forEach((result, index) => {
        if (result.status !== 'rejected') return;
        const source = HOME_SOURCE_NAMES[index] ?? `source_${index}`;
        issues.push(source);
        reportError('home.source.load', result.reason, { userId: user.id, projectId, source });
        // Do not clear last confirmed same-project data. On a project switch the
        // snapshot was reset before requests started, so no cross-project leak occurs.
      });

      loadedProjectIdRef.current = projectId;
      if (issues.length > 0) {
        setLoadWarning('Часть данных главной не обновилась. Показаны доступные или последние подтверждённые значения; нули и пустые блоки могут быть неполными.');
      }
    } catch (error) {
      if (!isCurrentLoad()) return;
      reportError('home.load', error, { userId: user.id, projectId });
      setLoadError('Не удалось загрузить данные главной');
      setLoadWarning('Не все данные удалось подтвердить. Повторите загрузку перед важным действием.');
    } finally {
      if (isCurrentLoad()) {
        loadedProjectIdRef.current = projectId;
        setLoading(false);
      }
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
    if (!activeProject || !dash || loadedProjectIdRef.current !== activeProject.id) return null;
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
      {loadWarning ? <InfoBanner tone="warning" title="Главная обновлена частично" message={loadWarning} /> : null}
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