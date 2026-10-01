import { Pressable, StyleSheet, Text, View } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { TEAM_ROLES, type TeamRoleId } from '@/lib/teamsUi';

/** Выбор роли участника бригады: Рабочий / Прораб / Наблюдатель (MKT-023). */
export function TeamRolePicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (role: TeamRoleId) => void;
  disabled?: boolean;
}) {
  return (
    <View style={s.row}>
      {TEAM_ROLES.map((r) => (
        <Pressable
          key={r.id}
          disabled={disabled || value === r.id}
          onPress={() => onChange(r.id)}
          accessibilityRole="button"
          accessibilityLabel={`Роль: ${r.label}`}
          style={[s.chip, value === r.id && s.on, disabled && s.off]}
        >
          <Text style={[s.t, value === r.id && s.tOn]}>{r.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: RenovaTheme.colors.surface,
  },
  on: { borderColor: RenovaTheme.colors.primary, backgroundColor: '#EFF6FF' },
  off: { opacity: 0.5 },
  t: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.text },
  tOn: { color: RenovaTheme.colors.primary },
});
