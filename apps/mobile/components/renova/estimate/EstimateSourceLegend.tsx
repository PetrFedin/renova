/** Кто заполняет строки сметы */
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme, card } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';

export function EstimateSourceLegend({ compact }: { compact?: boolean }) {
  return (
    <View style={[s.box, compact && s.compact]}>
      <Text style={s.title}>Кто заполняет</Text>
      <Text style={s.line}>• Авто — расчёт из параметров комнат (габариты, розетки, тип)</Text>
      <Text style={s.line}>• Подрядчик — ручные правки, новые строки и заметки к работам</Text>
      {!compact ? (
        <Text style={s.line}>• Подбор материалов — отдельный блок; заказчик согласует перед закупкой</Text>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: { ...card, marginBottom: 12, paddingVertical: 10, backgroundColor: '#F8FAFC' },
  compact: { paddingVertical: 8 },
  title: { ...screenTypography.section, marginTop: 0, marginBottom: 4 },
  line: { fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 17 },
});
