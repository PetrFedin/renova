import { View, Text, Pressable, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import type { StageDetail } from '@/lib/api';
import type { OsRole } from '@/constants/osSections';
import { budgetTabRoute, calendarTabRoute, objectTabRoute, repairTabRoute } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import { buildStageContextSummary } from '@/lib/domain/stageContextSummary';

export function StageContextSummary({ stage, role, returnTo }: { stage: StageDetail; role: OsRole; returnTo: string }) {
  const summary = buildStageContextSummary(stage);
  const priorityLabel = {
    issue: 'Проверить замечания', work: 'Закрыть просроченные работы', acceptance: 'Открыть приёмку',
    budget: 'Проверить бюджет', schedule: 'Проверить сроки', none: 'Следующий шаг не назначен',
  }[summary.priority];
  const priorityTarget = summary.priority === 'issue' ? repairTabRoute(role, 'control')
    : summary.priority === 'acceptance' ? repairTabRoute(role, 'control')
      : summary.priority === 'budget' ? budgetTabRoute(role, 'deviations', { stageId: stage.id })
        : calendarTabRoute(role, { stageId: stage.id });
  const open = (target: Parameters<typeof pushOsNav>[0]) => pushOsNav(target, returnTo, role);
  return (
    <View style={s.card}>
      <Text style={s.title}>Контекст этапа</Text>
      <Text style={s.location}>{summary.rooms ? `${summary.rooms} помещений` : 'Помещения не привязаны'} · {stage.name}</Text>
      <View style={s.metrics}>
        <Pressable style={s.metric} onPress={() => open(objectTabRoute(role, 'rooms'))}><Text style={s.value}>{summary.rooms}</Text><Text style={s.label}>Помещения</Text></Pressable>
        <Pressable style={s.metric} onPress={() => open(repairTabRoute(role, 'works'))}><Text style={s.value}>{summary.worksOpen}</Text><Text style={s.label}>Работы</Text></Pressable>
        <Pressable style={s.metric} onPress={() => open(repairTabRoute(role, 'control'))}><Text style={s.value}>{summary.comments}</Text><Text style={s.label}>Замечания</Text></Pressable>
        <Pressable style={s.metric} onPress={() => open(budgetTabRoute(role, 'expenses', { stageId: stage.id }))}><Text style={s.value}>{Math.round(summary.budgetAmount / 1000)}k</Text><Text style={s.label}>Бюджет</Text></Pressable>
      </View>
      <Pressable style={s.cta} onPress={() => open(priorityTarget)}><Text style={s.ctaText}>{priorityLabel} →</Text></Pressable>
    </View>
  );
}
const s = StyleSheet.create({ card: { marginBottom: 12, padding: 14, borderRadius: 14, backgroundColor: RenovaTheme.colors.surface, borderWidth: 1, borderColor: RenovaTheme.colors.border }, title: { fontSize: 17, fontWeight: '700', color: RenovaTheme.colors.text }, location: { marginTop: 4, color: RenovaTheme.colors.textMuted }, metrics: { flexDirection: 'row', gap: 8, marginTop: 12 }, metric: { flex: 1, minHeight: 52 }, value: { fontSize: 20, fontWeight: '700', color: RenovaTheme.colors.text }, label: { fontSize: 11, color: RenovaTheme.colors.textMuted }, cta: { marginTop: 10, paddingVertical: 10 }, ctaText: { color: RenovaTheme.colors.primary, fontWeight: '700' } });
