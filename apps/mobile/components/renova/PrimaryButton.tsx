import { Pressable, Text, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { RenovaTheme } from '@/constants/Theme';

type Props = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'outline' | 'ghost';
  compact?: boolean;
  fullWidth?: boolean;
  disabled?: boolean;
};

export function PrimaryButton({ title, onPress, variant = 'primary', compact, fullWidth, disabled }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        fullWidth && styles.fullWidth,
        compact && styles.compact,
        variant === 'outline' && styles.outline,
        variant === 'ghost' && styles.ghost,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
      onPress={() => { if (disabled) return; Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); onPress(); }}
    >
      <Text style={[styles.text, variant === 'outline' && styles.textOutline, variant === 'ghost' && styles.textGhost, disabled && styles.textDisabled]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { backgroundColor: RenovaTheme.colors.primary, paddingVertical: 9, paddingHorizontal: 14, borderRadius: RenovaTheme.radius.md, alignItems: 'center' },
  fullWidth: { alignSelf: 'stretch', width: '100%' },
  compact: { paddingVertical: 7, paddingHorizontal: 10 },
  outline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: RenovaTheme.colors.border },
  ghost: { backgroundColor: 'transparent', paddingVertical: 6 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.85 },
  text: { color: '#fff', fontSize: RenovaTheme.fontSize.body, fontWeight: '600' },
  textOutline: { color: RenovaTheme.colors.text },
  textGhost: { color: RenovaTheme.colors.primaryMuted, fontSize: RenovaTheme.fontSize.caption },
  textDisabled: { color: RenovaTheme.colors.textMuted },
});
