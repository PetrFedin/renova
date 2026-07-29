import { View, Text, Pressable, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { listRowStyles, screenTypography } from '@/constants/screenTypography';
import type { StageDetail } from '@/lib/api';
import type { OsRole } from '@/constants/osSections';
import { objectTabRoute, repairTabRoute } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import { buildStageContextSummary, stageContextPriorityTarget } from '@/lib/domain/stageContextSummary';

const PRIORITY_LABEL = {
  issue: 'Проверить доработку',
  acceptance: 'Открыть приёмку',
  work: 'Разобрать просроченные работы',
  budget: 'Проверить отклонение бюджета',
  schedule: 'Проверить срок этапа',
  none: '',
} as const;

type Props = {
  stage: StageDetail;
  role: OsRole;
  returnTo: string;
  showAction?: boolean;
};

export function StageContextSummary({ stage, role, returnTo, showAction = true }: Props) {
  const summary = buildStageContextSummary(stage);
  const priorityTarget = showAction ? stageContextPriorityTarget(summary.priority, role, stage.id) : null;
  const priorityLabel = PRIORITY_LABEL[summary.priority];
  const open = (target: Parameters<typeof pushOsNav>[0]) => pushOsNav(target, returnTo, role);
  const hasContext = summary.rooms > 0 || summary.worksOpen > 0 || summary.comments > 0 || summary.photos > 0 || priorityTarget;

  if (!hasContext) return null;

  return (
    <View style={s.wrap}>
      <Text style={s.heading}>Контекст этапа</Text>
      <View style={s.metrics}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Открыть помещения этапа, ${summary.rooms}`}
          style={s.metric}
          onPress={() => open(objectTabRoute(role, 'rooms'))}
        >
          <Text style={s.value}>{summary.rooms}</Text>
          <Text style={s.label}>Помещения</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Открыть незавершённые работы этапа, ${summary.worksOpen}`}
          style={s.metric}
          onPress={() => open(repairTabRoute(role, 'works', `stage:${stage.id}`))}
        >
          <Text style={s.value}>{summary.worksOpen}</Text>
          <Text style={s.label}>Открытые работы</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Открыть комментарии этапа, ${summary.comments}`}
          style={s.metric}
          onPress={() => open(repairTabRoute(role, 'control', `stage:${stage.id}`))}
        >
          <Text style={s.value}>{summary.comments}</Text>
          <Text style={s.label}>Комментарии</Text>
        </Pressable>
        <View accessible accessibilityLabel={`Фото этапа, ${summary.photos}`} style={s.metric}>
          <Text style={s.value}>{summary.photos}</Text>
          <Text style={s.label}>Фото</Text>
        </View>
      </View>
      {priorityTarget && priorityLabel ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={priorityLabel}
          style={s.action}
          onPress={() => open(priorityTarget)}
        >
          <Text style={s.actionText}>{priorityLabel} →</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    ...listRowStyles.row,
    borderBottomColor: RenovaTheme.colors.border,
    marginTop: RenovaTheme.spacing.sm,
  },
  heading: { ...screenTypography.section, marginTop: 0 },
  metrics: { ...listRowStyles.summaryRow, flexWrap: 'wrap' },
  metric: {
    ...listRowStyles.metricCell,
    minWidth: 112,
    minHeight: RenovaTheme.minTouch,
  },
  value: screenTypography.metric,
  label: screenTypography.metricLabel,
  action: {
    minHeight: RenovaTheme.minTouch,
    justifyContent: 'center',
  },
  actionText: screenTypography.listLink,
});
