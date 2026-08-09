/** Портфель — выбор объектов, итоги, статьи расходов, сравнение */
import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { replaceOsNav } from '@/lib/pushOsNav';
import { tabsRoute, type OsRole } from '@/constants/osSections';
import { RenovaTheme } from '@/constants/Theme';
import { useRenova } from '@/lib/context/RenovaContext';
import { filterOutJunkProjects } from '@/lib/junkProjects';
import { api } from '@/lib/api';
import { summarizePortfolio } from '@/lib/domain/summarizePortfolio';
import { aggregatePortfolioBudgetBreakdowns, type PortfolioCategoryRow } from '@/lib/domain/aggregatePortfolioBudget';
import { usePortfolioSelection } from '@/lib/portfolioSelection';
import { PortfolioSummaryHero } from '@/components/renova/os/portfolio/PortfolioSummaryHero';
import { PortfolioSelectionPanel } from '@/components/renova/os/portfolio/PortfolioSelectionPanel';
import { PortfolioCategoryBreakdown } from '@/components/renova/os/portfolio/PortfolioCategoryBreakdown';
import { PortfolioCompareList } from '@/components/renova/os/portfolio/PortfolioCompareList';
import { reportError } from '@/lib/reportError';

export function PortfolioProjectsView() {
  const { user, projects, activeProject, loadProject } = useRenova();
  const cleanProjects = filterOutJunkProjects(projects);
  const role: OsRole = user?.role === 'contractor' ? 'contractor' : 'customer';
  const allIds = useMemo(() => cleanProjects.map((p) => p.id), [cleanProjects]);
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
  const [pendingUnknownCount, setPendingUnknownCount] = useState(0);
  const [categories, setCategories] = useState<PortfolioCategoryRow[]>([]);
  const [catLoading, setCatLoading] = useState(false);
  const [categoryUnknownCount, setCategoryUnknownCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    const closing = cleanProjects.filter((p) => p.progress_percent >= 100);
    if (!closing.length) {
      setPendingById({});
      setPendingUnknownCount(0);
      return;
    }
    let cancelled = false;
    void Promise.all(
      closing.map(async (p) => {
        if (p.pending_payments != null) {
          return { projectId: p.id, value: p.pending_payments, failed: false } as const;
        }
        try {
          const value = (await api.countPendingPayments(user.id, p.id)) || 0;
          return { projectId: p.id, value, failed: false } as const;
        } catch (error) {
          reportError('portfolio.pendingPayments', error, { projectId: p.id });
          return { projectId: p.id, value: null, failed: true } as const;
        }
      }),
    )
      .then((rows) => {
        if (cancelled) return;
        const known = rows.filter(
          (row): row is { projectId: string; value: number; failed: false } => !row.failed && row.value !== null,
        );
        setPendingById(Object.fromEntries(known.map((row) => [row.projectId, row.value])));
        setPendingUnknownCount(rows.filter((row) => row.failed).length);
      })
      .catch((error) => {
        // Defensive aggregation guard: individual network failures are handled above.
        reportError('portfolio.pendingPayments.aggregate', error);
        if (!cancelled) setPendingUnknownCount(closing.length);
      });
    return () => { cancelled = true; };
  }, [user?.id, cleanProjects]);

  const selectedProjects = useMemo(
    () => cleanProjects.filter((p) => selected.has(p.id)),
    [cleanProjects, selected],
  );
  const allRows = useMemo(
    () => summarizePortfolio(cleanProjects, pendingById).rows,
    [cleanProjects, pendingById],
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
      setCategoryUnknownCount(0);
      return;
    }
    let cancelled = false;
    setCatLoading(true);
    void Promise.all(
      selectedProjects.map(async (p) => {
        try {
          return { projectId: p.id, value: await api.budgetBreakdown(user.id, p.id), failed: false } as const;
        } catch (error) {
          reportError('portfolio.budgetBreakdown', error, { projectId: p.id });
          return { projectId: p.id, value: null, failed: true } as const;
        }
      }),
    )
      .then((results) => {
        if (cancelled) return;
        const rows = results
          .filter((result) => !result.failed && result.value !== null)
          .map((result) => result.value!);
        setCategories(aggregatePortfolioBudgetBreakdowns(rows));
        setCategoryUnknownCount(results.filter((result) => result.failed).length);
      })
      .catch((error) => {
        reportError('portfolio.budgetBreakdown.aggregate', error);
        if (!cancelled) {
          setCategories([]);
          setCategoryUnknownCount(selectedProjects.length);
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
    } catch (error) {
      reportError('portfolio.openProject', error, { projectId: id });
      Alert.alert('Ошибка', 'Не удалось открыть объект');
    }
  }

  return (
    <View style={s.wrap}>
      <PortfolioSummaryHero summary={summary} selectedCount={selectedCount} totalCount={allCount} />

      {pendingUnknownCount > 0 ? (
        <Text style={s.partialWarning}>
          Статус финальных оплат неизвестен для {pendingUnknownCount} объект(ов). Они не помечены завершёнными до повторной проверки.
        </Text>
      ) : null}

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
          <PortfolioCategoryBreakdown
            rows={categories}
            loading={catLoading}
            projectCount={selectedCount}
            unavailableProjectCount={categoryUnknownCount}
          />
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
  partialWarning: {
    fontSize: 12,
    lineHeight: 17,
    color: RenovaTheme.colors.dangerText,
    backgroundColor: RenovaTheme.colors.dangerBg,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
});
