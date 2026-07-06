/** Компактная аналитика выполнения — календарь */
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme, card } from '@/constants/Theme';
import type { ScheduleExecutionStats } from '@/lib/domain/scheduleExecutionStats';

export function ScheduleExecutionStrip({ stats }: { stats: ScheduleExecutionStats }) {
  const items = [
    { label: 'Сегодня', value: stats.todayOpen, tone: stats.todayOpen > 0 ? 'accent' : 'muted' },
    { label: 'Просрочено', value: stats.overdue, tone: stats.overdue > 0 ? 'warn' : 'muted' },
    { label: 'Сделано за 7 дн.', value: stats.doneThisWeek, tone: stats.doneThisWeek > 0 ? 'good' : 'muted' },
    { label: 'Продления', value: stats.extensions, tone: stats.extensions > 0 ? 'neutral' : 'muted' },
  ] as const;

  return (
    <View style={s.wrap}>
      {items.map((it) => (
        <View key={it.label} style={s.chip}>
          <Text style={[s.val, s[`val_${it.tone}`]]}>{it.value}</Text>
          <Text style={s.label}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    ...card,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
    paddingVertical: 10,
  },
  chip: { minWidth: 72, alignItems: 'center' },
  val: { fontSize: 18, fontWeight: '800' },
  val_accent: { color: RenovaTheme.colors.primary },
  val_warn: { color: RenovaTheme.colors.warning },
  val_good: { color: RenovaTheme.colors.success },
  val_muted: { color: RenovaTheme.colors.textMuted },
  val_neutral: { color: RenovaTheme.colors.text },
  label: { fontSize: 10, fontWeight: '600', color: RenovaTheme.colors.textMuted, marginTop: 2, textAlign: 'center' },
});
