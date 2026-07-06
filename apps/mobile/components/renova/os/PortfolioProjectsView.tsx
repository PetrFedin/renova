/** Портфель — выбор объектов, итоги, статьи расходов, сравнение */
import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { replaceOsNav } from '@/lib/pushOsNav';
import { tabsRoute, type OsRole } from '@/constants/osSections';
import { RenovaTheme } from '@/constants/Theme';
import { useRenova } from '@/lib/context/RenovaContext';
import { api } from '@/lib/api';
import { summarizePortfolio } from '@/lib/domain/summarizePortfolio';
import { aggregatePortfolioBudgetBreakdowns, type PortfolioCategoryRow } from '@/lib/domain/aggregatePortfolioBudget';
import { usePortfolioSelection } from '@/lib/portfolioSelection';
import { PortfolioSummaryHero } from '@/components/renova/os/portfolio/PortfolioSummaryHero';
import { PortfolioSelectionPanel } from '@/components/renova/os/portfolio/PortfolioSelectionPanel';
import { PortfolioCategoryBreakdown } from '@/components/renova/os/portfolio/PortfolioCategoryBreakdown';
import { PortfolioCompareList } from '@/components/renova/os/portfolio/PortfolioCompareList';

export function PortfolioProjectsView() {
  const { user, projects, activeProject, loadProject } = useRenova();
  const role: OsRole = user?.role === 'contractor' ? 'contractor' : 'customer';
  const allIds = useMemo(() => projects.map((p) => p.id), [projects]);
  const {
    ready,
    selected,
    selectedCount,
    allCount,
    toggle,
    selectAll,
    clearAll,
  } = usePortfolioSelection(allIds);

  const [pendingById, setPendingById] = useState<Record<string, number>>({});
  const [categories, setCategories] = useState<PortfolioCategoryRow[]>([]);
  const [catLoading, setCatLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    const closing = projects.filter((p) => p.progress_percent >= 100);
    if (!closing.length) {
      setPendingById({});
      return;
    }
    let cancelled = false;
    Promise.all(
      closing.map(async (p) => {
        if (p.pending_payments != null) return [p.id, p.pending_payments] as const;
        try {
          const n = (await api.countPendingPayments(user.id, p.id)) || 0;
          return [p.id, n] as const;
        } catch {
          return [p.id, 0] as const;
        }
      }),
    ).then((rows) => {
      if (!cancelled) setPendingById(Object.fromEntries(rows));
    });
    return () => { cancelled = true; };
  }, [user?.id, projects]);

  const selectedProjects = useMemo(
    () => projects.filter((p) => selected.has(p.id)),
    [projects, selected],
  );
  const allRows = useMemo(
    () => summarizePortfolio(projects, pendingById).rows,
    [projects, pendingById],
  );
  const summary = useMemo(
    () => summarizePortfolio(selectedProjects, pendingById),
    [selectedProjects, pendingById],
  );

  const selectedIdsKey = useMemo(
    () => selectedProjects.map((p) => p.id).sort().join('|'),
    [selectedProjects],
  );

  useEffect(() => {
    if (!user || !selectedProjects.length) {
      setCategories([]);
      return;
    }
    let cancelled = false;
    setCatLoading(true);
    Promise.all(
      selectedProjects.map((p) => api.budgetBreakdown(user.id, p.id).catch(() => null)),
    )
      .then((rows) => {
        if (!cancelled) {
          setCategories(aggregatePortfolioBudgetBreakdowns(rows.filter(Boolean) as NonNullable<(typeof rows)[number]>[]));
        }
      })
      .finally(() => {
        if (!cancelled) setCatLoading(false);
      });
    return () => { cancelled = true; };
  }, [user?.id, selectedIdsKey]);

  if (!projects.length) {
    return <Text style={s.empty}>Нет проектов — создайте первый объект в профиле</Text>;
  }

  if (!ready) {
    return (
      <View style={s.loadingWrap}>
        <ActivityIndicator color={RenovaTheme.colors.accent} />
      </View>
    );
  }

  async function openProject(id: string) {
    try {
      await loadProject(id);
      replaceOsNav(tabsRoute(role, 'index'));
    } catch {
      Alert.alert('Ошибка', 'Не удалось открыть объект');
    }
  }

  return (
    <View style={s.wrap}>
      <PortfolioSummaryHero summary={summary} selectedCount={selectedCount} totalCount={allCount} />

      <PortfolioSelectionPanel
        rows={allRows}
        selected={selected}
        onToggle={toggle}
        onSelectAll={selectAll}
        onClearAll={clearAll}
        onOpen={openProject}
        activeProjectId={activeProject?.id}
      />

      {selectedCount > 0 ? (
        <>
          <PortfolioCategoryBreakdown rows={categories} loading={catLoading} projectCount={selectedCount} />
          <PortfolioCompareList rows={summary.rows} />
        </>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 12 },
  empty: { textAlign: 'center', color: RenovaTheme.colors.textMuted, marginTop: 24, fontSize: 14 },
  loadingWrap: { paddingVertical: 32, alignItems: 'center' },
});
