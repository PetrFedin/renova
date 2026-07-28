import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { ActivityFeed } from '@/components/renova/ActivityFeed';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { EmptyActionState } from '@/components/ui/EmptyActionState';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';
import { api } from '@/lib/api';
import type { OsBudgetSummary, OsInsight, OsRisk } from '@/lib/api/types';
import { useRenova } from '@/lib/context/RenovaContext';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { pushOsNav } from '@/lib/pushOsNav';
import { tabsRoute, type OsRole } from '@/constants/osSections';

type LoadState = {
  budget: OsBudgetSummary | null;
  risks: OsRisk[];
  insights: OsInsight[];
};

function riskLabel(risk?: string | null) {
  switch (risk) {
    case 'critical': return 'Критичный';
    case 'high': return 'Высокий';
    case 'medium': return 'Средний';
    case 'low': return 'Низкий';
    default: return 'Без оценки';
  }
}

function severityTone(value?: string | null) {
  if (['critical', 'high'].includes(value || '')) return RenovaTheme.colors.dangerText;
  if (value === 'medium') return RenovaTheme.colors.warningText;
  return RenovaTheme.colors.successText;
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <View style={styles.kpiCard}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={styles.kpiValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.kpiHint} numberOfLines={2}>{hint}</Text>
    </View>
  );
}

export function ManagerDashboardScreen() {
  const { user, activeProject } = useRenova();
  const role: OsRole = user?.role === 'contractor' ? 'contractor' : 'customer';
  const [state, setState] = useState<LoadState>({ budget: null, risks: [], insights: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user || !activeProject) return;
    setLoadError(false);
    try {
      const [budget, risks, insights] = await Promise.all([
        api.osBudget(user.id, activeProject.id),
        api.osRisks(user.id, activeProject.id).then((r) => r.items),
        api.osInsights(user.id, activeProject.id).then((r) => r.items),
      ]);
      setState({ budget, risks, insights });
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, activeProject]);
  useProjectDataReload(load);

  useEffect(() => { load(); }, [load]);

  const topRisk = useMemo(() => state.risks[0], [state.risks]);
  const topInsight = useMemo(() => [...state.insights].sort((a, b) => b.priority - a.priority)[0], [state.insights]);
  const budget = state.budget;
  const riskColor = severityTone(topRisk?.severity || budget?.risk);

  if (!user || !activeProject) {
    const role: OsRole = user?.role === 'contractor' ? 'contractor' : 'customer';
    return (
      <View style={styles.center}>
        <EmptyActionState
          title="Нет активного проекта"
          hint="Выберите объект на главной, чтобы открыть управленческую сводку."
          actionLabel="На главную"
          actionVariant="primary"
          onAction={() => pushOsNav(tabsRoute(role, 'index'), undefined, role)}
        />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={RenovaTheme.colors.primaryMuted} />
        <Text style={styles.stateText}>Собираем управленческую сводку...</Text>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.center}>
        <Text style={styles.stateTitle}>Не удалось загрузить сводку</Text>
        <Text style={styles.stateText}>Ошибка API — не пустой «хороший» статус. Потяните вниз или откройте снова.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.back}>‹ Назад</Text></Pressable>
        <Text style={styles.title}>Управленческая сводка</Text>
        <Text style={styles.subtitle}>{activeProject.name}</Text>
      </View>

      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>Главный риск</Text>
        <Text style={[styles.heroTitle, { color: riskColor }]}>{topRisk?.title || riskLabel(budget?.risk)}</Text>
        <Text style={styles.heroText}>{topRisk?.impact || 'Критичных отклонений в текущей сводке нет.'}</Text>
        {topRisk?.href ? <PrimaryButton title="Открыть риск" variant="outline" compact onPress={() => pushOsNav(topRisk.href!, undefined, role)} /> : null}
      </View>

      <View style={styles.kpiGrid}>
        <KpiCard
          label="Бюджет"
          value={budget ? formatRub(budget.budget_spent) : '—'}
          hint={budget ? `План: ${formatRub(budget.budget_planned)} · отклонение ${Math.round(budget.deviation_pct || 0)}%` : 'Нет данных бюджета'}
        />
        <KpiCard
          label="Прогноз"
          value={budget ? formatRub(budget.forecast_total) : '—'}
          hint={budget ? `Перерасход: ${formatRub(Math.max(0, budget.forecast_over || 0))}` : 'Прогноз недоступен'}
        />
        <KpiCard
          label="Риски"
          value={`${state.risks.length}`}
          hint={topRisk ? riskLabel(topRisk.severity) : 'Нет активных рисков'}
        />
        <KpiCard
          label="Инсайты"
          value={`${state.insights.length}`}
          hint={topInsight?.title || 'Нет новых рекомендаций'}
        />
      </View>

      {topInsight ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Что сделать первым</Text>
          <Text style={styles.itemTitle}>{topInsight.title}</Text>
          <Text style={styles.itemText}>{topInsight.body}</Text>
          <PrimaryButton title={topInsight.action || 'Открыть'} variant="outline" onPress={() => pushOsNav(topInsight.href, undefined, role)} />
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Последние события</Text>
        <ActivityFeed userId={user.id} projectId={activeProject.id} compact returnTo="/manager-dashboard" />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  content: { padding: RenovaTheme.spacing.lg, paddingBottom: 32, gap: RenovaTheme.spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8, backgroundColor: RenovaTheme.colors.background },
  header: { gap: 4 },
  back: { fontSize: RenovaTheme.fontSize.body, color: RenovaTheme.colors.primaryMuted, fontWeight: RenovaTheme.fontWeight.semibold },
  title: { fontSize: RenovaTheme.fontSize.h1, fontWeight: RenovaTheme.fontWeight.bold, color: RenovaTheme.colors.text },
  subtitle: { fontSize: RenovaTheme.fontSize.body, color: RenovaTheme.colors.textMuted },
  // Clarity V: risk strip без тяжёлого Theme.card
  heroCard: {
    gap: RenovaTheme.spacing.sm,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderLeftWidth: 3,
    borderLeftColor: RenovaTheme.colors.primaryMuted,
    paddingLeft: 12,
  },
  heroLabel: { ...screenTypography.metricLabel, letterSpacing: 0 },
  heroTitle: { ...screenTypography.listTitle, fontSize: 18, lineHeight: 24 },
  heroText: { ...screenTypography.empty },
  kpiGrid: { ...listRowStyles.summaryRow, flexWrap: 'wrap' },
  kpiCard: { ...listRowStyles.metricCell, width: '48%', minWidth: '46%', minHeight: 100, gap: 4 },
  kpiLabel: { ...screenTypography.metricLabel },
  kpiValue: { ...screenTypography.metric, fontSize: 18 },
  kpiHint: { ...screenTypography.listMeta, textAlign: 'center' },
  card: { gap: RenovaTheme.spacing.sm, paddingVertical: 8 },
  sectionTitle: { ...screenTypography.section, marginTop: 0 },
  itemTitle: { ...screenTypography.listTitle },
  itemText: { ...screenTypography.empty },
  stateTitle: { ...screenTypography.listTitle, textAlign: 'center' },
  stateText: { ...screenTypography.empty, textAlign: 'center' },
});
