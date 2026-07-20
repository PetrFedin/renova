import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { ActivityFeed } from '@/components/renova/ActivityFeed';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme, card, formatRub } from '@/constants/Theme';
import { api } from '@/lib/api';
import type { OsBudgetSummary, OsInsight, OsRisk } from '@/lib/api/types';
import { useRenova } from '@/lib/context/RenovaContext';
import { useProjectDataReload } from '@/lib/useProjectDataReload';

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
  const [state, setState] = useState<LoadState>({ budget: null, risks: [], insights: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user || !activeProject) return;
    try {
      const [budget, risks, insights] = await Promise.all([
        api.osBudget(user.id, activeProject.id).catch(() => null),
        api.osRisks(user.id, activeProject.id).then((r) => r.items).catch(() => []),
        api.osInsights(user.id, activeProject.id).then((r) => r.items).catch(() => []),
      ]);
      setState({ budget, risks, insights });
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
    return (
      <View style={styles.center}>
        <Text style={styles.stateTitle}>Нет активного проекта</Text>
        <Text style={styles.stateText}>Выберите проект, чтобы открыть управленческую сводку.</Text>
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
        {topRisk?.href ? <PrimaryButton title="Открыть риск" variant="outline" compact onPress={() => router.push(topRisk.href as never)} /> : null}
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
          <PrimaryButton title={topInsight.action || 'Открыть'} variant="outline" onPress={() => router.push(topInsight.href as never)} />
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
  heroCard: { ...card, gap: RenovaTheme.spacing.sm, borderLeftWidth: 4, borderLeftColor: RenovaTheme.colors.primaryMuted },
  heroLabel: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted, fontWeight: RenovaTheme.fontWeight.bold, textTransform: 'uppercase', letterSpacing: 0.4 },
  heroTitle: { fontSize: RenovaTheme.fontSize.h2, fontWeight: RenovaTheme.fontWeight.extrabold, lineHeight: 26 },
  heroText: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, lineHeight: 18 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: RenovaTheme.spacing.sm },
  kpiCard: { ...card, width: '48%', minHeight: 118, gap: 5 },
  kpiLabel: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted, fontWeight: RenovaTheme.fontWeight.bold },
  kpiValue: { fontSize: RenovaTheme.fontSize.h3, color: RenovaTheme.colors.text, fontWeight: RenovaTheme.fontWeight.extrabold },
  kpiHint: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted, lineHeight: 16 },
  card: { ...card, gap: RenovaTheme.spacing.sm },
  sectionTitle: { fontSize: RenovaTheme.fontSize.h3, color: RenovaTheme.colors.text, fontWeight: RenovaTheme.fontWeight.bold },
  itemTitle: { fontSize: RenovaTheme.fontSize.body, color: RenovaTheme.colors.text, fontWeight: RenovaTheme.fontWeight.extrabold },
  itemText: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, lineHeight: 18 },
  stateTitle: { fontSize: RenovaTheme.fontSize.h3, fontWeight: RenovaTheme.fontWeight.bold, color: RenovaTheme.colors.text, textAlign: 'center' },
  stateText: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, textAlign: 'center', lineHeight: 18 },
});
