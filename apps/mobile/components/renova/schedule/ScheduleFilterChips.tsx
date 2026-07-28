/** Горизонтальные фильтры — Clarity V: общий filterChipStyles SoT */
import { ScrollView, View, Text, Pressable } from 'react-native';
import { filterChipStyles } from '@/constants/screenTypography';

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
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={filterChipStyles.row}>
      {items.map((f) => (
        <Pressable
          key={f.key}
          style={[filterChipStyles.chip, value === f.key && filterChipStyles.chipOn]}
          onPress={() => onChange(f.key)}
        >
          <Text style={[filterChipStyles.chipT, value === f.key && filterChipStyles.chipTOn]}>{f.label}</Text>
        </Pressable>
      ))}
      <View style={{ width: 4 }} />
    </ScrollView>
  );
}
