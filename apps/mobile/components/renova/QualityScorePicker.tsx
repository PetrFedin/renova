/** W139: явная оценка 0–10 или «без оценки» — никогда не подставляем 10/5 автоматически */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';

const PRESETS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export function QualityScorePicker({
  value,
  onChange,
  label = 'Оценка качества (необязательно)',
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  label?: string;
}) {
  return (
    <View style={s.wrap} accessibilityRole="radiogroup">
      <Text style={s.label}>{label}</Text>
      <View style={s.row}>
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ selected: value == null }}
          onPress={() => onChange(null)}
          style={[s.chip, value == null && s.chipOn]}
        >
          <Text style={[s.chipText, value == null && s.chipTextOn]}>Без оценки</Text>
        </Pressable>
        {PRESETS.map((n) => {
          const on = value === n;
          return (
            <Pressable
              key={n}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => onChange(n)}
              style={[s.chip, on && s.chipOn]}
            >
              <Text style={[s.chipText, on && s.chipTextOn]}>{n}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 6, marginTop: 4 },
  label: { fontSize: 11, color: RenovaTheme.colors.textMuted },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RenovaTheme.radius.sm,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surface,
  },
  chipOn: {
    borderColor: RenovaTheme.colors.accent,
    backgroundColor: RenovaTheme.colors.accentMuted,
  },
  chipText: { fontSize: 12, color: RenovaTheme.colors.text, fontWeight: '500' },
  chipTextOn: { color: RenovaTheme.colors.accent, fontWeight: '700' },
});