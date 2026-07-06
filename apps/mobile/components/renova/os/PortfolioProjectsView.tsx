/** Полный экран портфеля — список проектов без deprecated CustomerPortfolioPanel */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { replaceOsNav } from '@/lib/pushOsNav';
import { tabsRoute } from '@/constants/osSections';
import { RenovaTheme, formatRub, card } from '@/constants/Theme';
import { useRenova } from '@/lib/context/RenovaContext';
import { OsWidgetGrid, type OsWidget } from '@/components/renova/os/OsWidgetStrip';
import { PlanFactObjects } from '@/components/renova/PlanFactObjects';

export function PortfolioProjectsView() {
  const { projects, activeProject, loadProject } = useRenova();
  if (!projects.length) {
    return <Text style={s.empty}>Нет проектов — создайте первый объект в профиле</Text>;
  }

  const totalPlan = projects.reduce((a, p) => a + p.budget_planned, 0);
  const totalSpent = projects.reduce((a, p) => a + p.budget_spent, 0);
  const avgProgress = Math.round(projects.reduce((a, p) => a + p.progress_percent, 0) / projects.length);

  const summaryWidgets: OsWidget[] = [
    { id: 'cnt', label: 'Проекты', value: String(projects.length), width: 88 },
    { id: 'plan', label: 'План', value: formatRub(totalPlan), width: 100 },
    { id: 'fact', label: 'Факт', value: formatRub(totalSpent), hint: `${Math.round((totalSpent / Math.max(1, totalPlan)) * 100)}%`, width: 100 },
    { id: 'prog', label: 'Прогресс', value: `${avgProgress}%`, width: 96 },
  ];

  return (
    <View style={s.wrap}>
      <OsWidgetGrid items={summaryWidgets} />
      <View style={s.projGrid}>
        {(() => {
          const rows: typeof projects[] = [];
          for (let i = 0; i < projects.length; i += 2) rows.push(projects.slice(i, i + 2) as typeof projects);
          return rows.map((row, ri) => (
            <View key={ri} style={s.projRow}>
              {row.map((p) => (
                <Pressable
                  key={p.id}
                  style={[s.projChip, activeProject?.id === p.id && s.projChipOn]}
                  onPress={() => loadProject(p.id).then(() => replaceOsNav(tabsRoute('customer', 'index'))).catch(() => {})}
                >
                  <Text style={s.projName} numberOfLines={2}>{p.name}</Text>
                  <Text style={s.projMeta}>{formatRub(p.budget_spent)} · {p.progress_percent}%</Text>
                  <View style={s.barBg}>
                    <View style={[s.barFill, { width: `${Math.min(100, p.progress_percent)}%` }]} />
                  </View>
                </Pressable>
              ))}
              {row.length === 1 && <View style={[s.projChip, s.ghost]} />}
            </View>
          ));
        })()}
      </View>
      <PlanFactObjects items={projects.map((p) => ({ name: p.name, planned: p.budget_planned, spent: p.budget_spent }))} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 10 },
  empty: { textAlign: 'center', color: RenovaTheme.colors.textMuted, marginTop: 24, fontSize: 14 },
  projGrid: { gap: 8, marginBottom: 10 },
  projRow: { flexDirection: 'row', gap: 8 },
  projChip: { ...card, flex: 1, minWidth: 0, marginBottom: 0, padding: 10 },
  ghost: { opacity: 0, borderWidth: 0 },
  projChipOn: { borderColor: RenovaTheme.colors.accent, backgroundColor: '#EFF6FF' },
  projName: { fontSize: 14, fontWeight: '700', color: RenovaTheme.colors.text },
  projMeta: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 4 },
  barBg: { height: 4, backgroundColor: RenovaTheme.colors.border, borderRadius: 2, marginTop: 8, overflow: 'hidden' },
  barFill: { height: 4, backgroundColor: RenovaTheme.colors.accent },
});
