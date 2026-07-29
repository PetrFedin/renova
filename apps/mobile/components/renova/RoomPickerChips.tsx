/** Выбор комнаты — чеки, расходы и строки сметы */
import { Pressable, Text, View } from 'react-native';

import { formSurfaceStyles } from '@/constants/formStyles';
import { filterChipStyles, screenTypography } from '@/constants/screenTypography';
import { roomTypeLabel } from '@/constants/roomTypes';
import type { Room } from '@/lib/api';

export function RoomPickerChips({
  rooms,
  value,
  onChange,
  optional = true,
  disabled = false,
  label,
}: {
  rooms: Room[];
  value?: string | null;
  onChange: (roomId: string | null) => void;
  optional?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const resolvedLabel = label ?? (optional ? 'Комната (необязательно)' : 'Комната');
  return (
    <View>
      <Text style={formSurfaceStyles.label}>{resolvedLabel}</Text>
      <View style={filterChipStyles.row}>
        {optional ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Общий расход без комнаты"
            accessibilityState={{ selected: !value, disabled }}
            disabled={disabled}
            style={[filterChipStyles.chip, formSurfaceStyles.chipTouch, !value && filterChipStyles.chipOn]}
            onPress={() => onChange(null)}
          >
            <Text style={[filterChipStyles.chipT, !value && filterChipStyles.chipTOn]}>Общее</Text>
          </Pressable>
        ) : null}
        {rooms.map((room) => {
          const selected = value === room.id;
          return (
            <Pressable
              key={room.id}
              accessibilityRole="button"
              accessibilityLabel={`Комната: ${room.name}`}
              accessibilityState={{ selected, disabled }}
              disabled={disabled}
              style={[filterChipStyles.chip, formSurfaceStyles.chipTouch, selected && filterChipStyles.chipOn]}
              onPress={() => onChange(room.id)}
            >
              <Text style={[filterChipStyles.chipT, selected && filterChipStyles.chipTOn]}>{room.name}</Text>
              <Text style={[screenTypography.metricLabel, selected && filterChipStyles.chipTOn]}>
                {roomTypeLabel(room.room_type)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
