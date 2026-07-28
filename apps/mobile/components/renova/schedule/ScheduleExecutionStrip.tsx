/** Компактная аналитика выполнения — календарь */
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';
import type { ScheduleExecutionStats } from '@/lib/domain/scheduleExecutionStats';

export function ScheduleExecutionStrip({ stats }: { stats: ScheduleExecutionStats }) {
  const items = [
    { label: 'Сегодня', value: stats.todayOpen, tone: stats.todayOpen > 0 ? 'accent' : 'muted' },
    { label: 'Просрочено', value: stats.overdue, tone: stats.overdue > 0 ? 'warn' : 'muted' },
    { label: '7 дн', value: stats.doneThisWeek, tone: stats.doneThisWeek > 0 ? 'good' : 'muted' },
    { label: 'Продления', value: stats.extensions, tone: stats.extensions > 0 ? 'neutral' : 'muted' },
  ] as const;

  return (
    <View style={s.wrap}>
      {items.map((it) => (
        <View key={it.label} style={s.chip}>
          <Text style={[s.val, s[`val_${it.tone}`]]}>{it.value}</Text>
          <Text style={s.label} numberOfLines={1}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  // Clarity W: summaryRow + metricCell вместо Theme.card + 800
  wrap: {
    ...listRowStyles.summaryRow,
    marginBottom: 10,
  },
  chip: { ...listRowStyles.metricCell },
  val: { ...screenTypography.metric, fontSize: 18 },
  val_accent: { color: RenovaTheme.colors.primary },
  val_warn: { color: RenovaTheme.colors.warning },
  val_good: { color: RenovaTheme.colors.success },
  val_muted: { color: RenovaTheme.colors.textMuted },
  val_neutral: { color: RenovaTheme.colors.text },
  label: { ...screenTypography.metricLabel, textAlign: 'center' },
});
