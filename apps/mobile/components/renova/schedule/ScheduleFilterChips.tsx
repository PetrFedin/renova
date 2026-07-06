/** Горизонтальные фильтры — компактные чипы */
import { ScrollView, View, Text, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';

export function ScheduleFilterChips({
  items,
  value,
  onChange,
}: {
  items: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
      {items.map((f) => (
        <Pressable key={f.key} style={[s.chip, value === f.key && s.chipOn]} onPress={() => onChange(f.key)}>
          <Text style={[s.chipT, value === f.key && s.chipTOn]}>{f.label}</Text>
        </Pressable>
      ))}
      <View style={{ width: 4 }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6, paddingVertical: 2 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: RenovaTheme.colors.borderLight,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
  },
  chipOn: { backgroundColor: RenovaTheme.colors.accent, borderColor: RenovaTheme.colors.accent },
  chipT: { fontSize: 11, fontWeight: '600', color: RenovaTheme.colors.textMuted },
  chipTOn: { color: RenovaTheme.colors.surface },
});
