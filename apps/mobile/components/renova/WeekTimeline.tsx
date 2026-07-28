import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';
import { Stage } from '@/lib/api';

export function WeekTimeline({ stages }: { stages: Stage[] }) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
  return (
    <View style={s.box}>
      <Text style={s.head}>Неделя</Text>
      <View style={s.row}>{days.map(d => {
        const n = stages.filter(st => st.planned_end === d || st.planned_start === d).length;
        return (
          <View key={d} style={s.cell}>
            <Text style={s.d}>{d.slice(5)}</Text>
            <Text style={s.n}>{n || '·'}</Text>
          </View>
        );
      })}</View>
    </View>
  );
}
const s = StyleSheet.create({
  // Clarity T: SoT вместо локального card/head 800
  box: {
    ...listRowStyles.metricCell,
    alignItems: 'stretch',
    padding: 12,
    marginBottom: 10,
  },
  head: { ...screenTypography.section, marginTop: 0, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  cell: { alignItems: 'center', flex: 1 },
  d: { ...screenTypography.metricLabel, marginTop: 0 },
  n: { ...screenTypography.listTitle, fontSize: 14, marginTop: 4 },
});
