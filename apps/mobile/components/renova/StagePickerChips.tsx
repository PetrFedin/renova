/** Выбор этапа для финансовых и операционных форм */
import { Pressable, Text, View } from 'react-native';

import { formSurfaceStyles } from '@/constants/formStyles';
import { filterChipStyles } from '@/constants/screenTypography';
import type { Stage } from '@/lib/api';

export function StagePickerChips({
  stages,
  value,
  onChange,
  optional = true,
  disabled = false,
  label,
}: {
  stages: Stage[];
  value?: string | null;
  onChange: (id: string | null) => void;
  optional?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  if (!stages.length) return null;
  const resolvedLabel = label ?? (optional ? 'Этап (необязательно)' : 'Этап');

  return (
    <View>
      <Text style={formSurfaceStyles.label}>{resolvedLabel}</Text>
      <View style={filterChipStyles.row}>
        {optional ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Без этапа"
            accessibilityState={{ selected: !value, disabled }}
            disabled={disabled}
            style={[filterChipStyles.chip, formSurfaceStyles.chipTouch, !value && filterChipStyles.chipOn]}
            onPress={() => onChange(null)}
          >
            <Text style={[filterChipStyles.chipT, !value && filterChipStyles.chipTOn]}>Без этапа</Text>
          </Pressable>
        ) : null}
        {stages.map((stage) => {
          const selected = value === stage.id;
          return (
            <Pressable
              key={stage.id}
              accessibilityRole="button"
              accessibilityLabel={`Этап: ${stage.name}`}
              accessibilityState={{ selected, disabled }}
              disabled={disabled}
              style={[filterChipStyles.chip, formSurfaceStyles.chipTouch, selected && filterChipStyles.chipOn]}
              onPress={() => onChange(stage.id)}
            >
              <Text style={[filterChipStyles.chipT, selected && filterChipStyles.chipTOn]} numberOfLines={1}>
                {stage.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
