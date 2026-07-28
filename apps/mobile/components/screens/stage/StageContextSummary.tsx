import { View, Text, Pressable, StyleSheet } from 'react-native';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';
import type { StageDetail } from '@/lib/api';
import type { OsRole } from '@/constants/osSections';
import { objectTabRoute, repairTabRoute } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import { buildStageContextSummary, stageContextPriorityTarget } from '@/lib/domain/stageContextSummary';

export function StageContextSummary({ stage, role, returnTo }: { stage: StageDetail; role: OsRole; returnTo: string }) {
  const summary = buildStageContextSummary(stage);
  const priorityLabel = {
    issue: 'Проверить замечания', work: 'Закрыть просроченные работы', acceptance: 'Открыть приёмку',
    budget: 'Проверить бюджет', schedule: 'Проверить сроки', none: 'Следующий шаг не назначен',
  }[summary.priority];
  const priorityTarget = stageContextPriorityTarget(summary.priority, role, stage.id);
  const open = (target: Parameters<typeof pushOsNav>[0]) => pushOsNav(target, returnTo, role);
  return (
    <View style={s.card}>
      <Text style={s.title}>Контекст этапа</Text>
      <Text style={s.location}>{summary.rooms ? `${summary.rooms} помещений` : 'Помещения не привязаны'} · {stage.name}</Text>
      <View style={s.metrics}>
        <Pressable accessibilityRole="button" accessibilityLabel="Открыть помещения этапа" style={s.metric} onPress={() => open(objectTabRoute(role, 'rooms'))}><Text style={s.value}>{summary.rooms}</Text><Text style={s.label}>Помещения</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Открыть работы этапа" style={s.metric} onPress={() => open(repairTabRoute(role, 'works', `stage:${stage.id}`))}><Text style={s.value}>{summary.worksOpen}</Text><Text style={s.label}>Работы</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Открыть контроль этапа" style={s.metric} onPress={() => open(repairTabRoute(role, 'control', `stage:${stage.id}`))}><Text style={s.value}>{summary.comments}</Text><Text style={s.label}>Комментарии</Text></Pressable>
        {summary.payableAmount != null ? <Pressable accessibilityRole="button" accessibilityLabel="Открыть расходы этапа" style={s.metric} onPress={() => open(repairTabRoute(role, 'control', `stage:${stage.id}`))}><Text style={s.value}>{formatRub(summary.payableAmount)}</Text><Text style={s.label}>К оплате</Text></Pressable> : null}
      </View>
      {priorityTarget ? <Pressable accessibilityRole="button" accessibilityLabel={priorityLabel} style={s.cta} onPress={() => open(priorityTarget)}><Text style={s.ctaText}>{priorityLabel} →</Text></Pressable> : null}
    </View>
  );
}
const s = StyleSheet.create({ card: { marginBottom: 12, padding: 14, borderRadius: RenovaTheme.radius.md, backgroundColor: RenovaTheme.colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: RenovaTheme.colors.border }, title: { ...screenTypography.section, marginTop: 0, color: RenovaTheme.colors.text }, location: { ...screenTypography.listMeta }, metrics: { ...listRowStyles.summaryRow, flexWrap: 'wrap' }, metric: { ...listRowStyles.metricCell, minWidth: 68, minHeight: RenovaTheme.minTouch }, value: screenTypography.metric, label: screenTypography.metricLabel, cta: { marginTop: 10, minHeight: RenovaTheme.minTouch, justifyContent: 'center' }, ctaText: { ...screenTypography.listLink } });
