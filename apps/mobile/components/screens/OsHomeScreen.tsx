/** Единая главная Renova OS — заказчик и исполнитель */
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { type BudgetAlert } from '@/components/renova/BudgetAlerts';
import { HomeScreenBody } from '@/components/renova/os/home/HomeScreenBody';
import { homeLayout } from '@/constants/homeTypography';
import { useHomeWidgets } from '@/lib/useHomeWidgets';
import { useRenova } from '@/lib/context/RenovaContext';
import { buildProjectOsSnapshot } from '@/lib/domain/buildProjectOsSnapshot';
import { buildHomeMoreSummary, homeMoreHasVisibleContent } from '@/lib/domain/buildHomeMoreSummary';
import { formatProjectHeaderMeta } from '@/lib/domain/resolveProjectPhase';
import { buildHomeSearchHints } from '@/lib/domain/buildHomeSearchHints';
import { clearHomeSearchHints, setHomeSearchHints } from '@/lib/homeSearchHints';
import { fallbackDashboard } from '@/lib/domain/fallbackDashboard';
import { api, Dashboard, ReceiptItem, MaterialPick, Purchase, OsRisk, OsScheduleSummary, OsInsight, OsBudgetSummary } from '@/lib/api';
import type { OsRole } from '@/constants/osSections';

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const snapRole = readOnly ? 'customer' : role === 'contractor' ? 'contractor' : 'customer';
  const { isVisible } = useHomeWidgets(role);

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

      if (role === 'customer') {
        try {
          const items = await api.listPayments(user.id, activeProject.id);
          const pending = items.filter((p) => p.status === 'pending');
          setPendingPayments(pending.length);
          setPendingPaymentTotal(pending.reduce((sum, p) => sum + p.amount, 0));
        } catch {
          setPendingPayments(0);
          setPendingPaymentTotal(0);
        }
      } else {
        setPendingPayments(0);
        setPendingPaymentTotal(0);
      }

      const results = await Promise.allSettled([
        api.listReceipts(user.id, activeProject.id).then(setReceipts),
        api.listMaterialPicks(user.id, activeProject.id).then(setPicks),
        api.listPurchases(user.id, activeProject.id).then(setPurchases),
        api.osRisks(user.id, activeProject.id).then((r) => setApiRisks(r.items)),
        api.osSchedule(user.id, activeProject.id).then(setOsSchedule),
        api.osInsights(user.id, activeProject.id).then((r) => setInsights(r.items)),
        api.budgetAlerts(user.id, activeProject.id).then(setBudgetAlerts),
        api.osBudget(user.id, activeProject.id).then(setOsBudget),
        api.acceptancesPendingCount(user.id, activeProject.id).then((r) => setPendingAcceptance(r.count)),
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
          ];
          fallbacks[i]?.();
        }
      });
    } catch (e) {
      setLoadError('error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); refreshProjects().catch(() => {}); }, [user?.id, activeProject?.id]);

  const snap = useMemo(() => {
    if (!activeProject || !dash) return null;
    return buildProjectOsSnapshot(activeProject, dash, receipts, picks, purchases, apiRisks, osSchedule, snapRole as any, osBudget, pendingAcceptance, pendingPayments, pendingPaymentTotal);
  }, [activeProject, dash, receipts, picks, purchases, apiRisks, osSchedule, snapRole, osBudget, pendingAcceptance, pendingPayments, pendingPaymentTotal]);

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
        <PrimaryButton title="Заявки и новые объекты" onPress={() => router.push('/job-leads')} />
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
      <ScrollView style={s.container} contentContainerStyle={s.content}>
        <ProjectEmptyState
          role={role}
          title={projects.length === 0 ? 'Создайте первый объект' : 'Сменить объект'}
          hint={
            projects.length === 0
              ? 'Создайте первый объект — смета, этапы и учёт расходов появятся автоматически.'
              : 'Не удалось открыть объект с главной. Выберите другой из списка или создайте новый.'
          }
          showCreate
          hideHomeButton
        />
      </ScrollView>
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
        <PrimaryButton title="Повторить" onPress={() => load().catch(() => {})} />
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
    showWorksMaterials,
  };
  const moreSummary = buildHomeMoreSummary(moreArgs);
  const moreHasContent = homeMoreHasVisibleContent(moreArgs);

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
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
