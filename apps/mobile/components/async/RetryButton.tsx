/** Кнопка повтора загрузки — единый CTA для error/stale */
import { Pressable, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';

export function RetryButton({
  onPress,
  label = 'Повторить',
  busy = false,
  compact = false,
}: {
  onPress: () => void;
  label?: string;
  busy?: boolean;
  compact?: boolean;
}) {
  return (
    <Pressable
      style={[s.btn, compact && s.compact]}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {busy ? (
        <ActivityIndicator size="small" color={RenovaTheme.colors.primary} />
      ) : (
        <Text style={s.t}>{label}</Text>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  btn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: RenovaTheme.colors.surface,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
  },
  compact: { paddingHorizontal: 10, paddingVertical: 6 },
  t: { fontWeight: '700', fontSize: 13, color: RenovaTheme.colors.primary },
});
