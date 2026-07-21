import { Pressable, Text, StyleSheet, ActivityIndicator, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { RenovaTheme } from '@/constants/Theme';
import { reportCatch } from '@/lib/reportError';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'dangerOutline';
type Size = 'sm' | 'md' | 'lg';

type Props = {
  title: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  /** @deprecated use size="sm" */
  compact?: boolean;
  fullWidth?: boolean;
  disabled?: boolean;
  loading?: boolean;
};

const sizePad: Record<Size, { v: number; h: number; font: number }> = {
  sm: { v: 7, h: 10, font: RenovaTheme.fontSize.caption },
  md: { v: 10, h: 14, font: RenovaTheme.fontSize.body },
  lg: { v: 12, h: 18, font: RenovaTheme.fontSize.body },
};

export function PrimaryButton({
  title,
  onPress,
  variant = 'primary',
  size,
  compact,
  fullWidth,
  disabled,
  loading,
}: Props) {
  const sz = size ?? (compact ? 'sm' : 'md');
  const pad = sizePad[sz];
  const isDanger = variant === 'danger' || variant === 'dangerOutline';
  const isOutline = variant === 'outline' || variant === 'dangerOutline';
  const isGhost = variant === 'ghost';
  const isSecondary = variant === 'secondary';

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        { paddingVertical: pad.v, paddingHorizontal: pad.h },
        fullWidth && styles.fullWidth,
        isSecondary && styles.secondary,
        isOutline && !isDanger && styles.outline,
        isOutline && isDanger && styles.dangerOutline,
        variant === 'danger' && styles.danger,
        isGhost && styles.ghost,
        (disabled || loading) && styles.disabled,
        pressed && !disabled && !loading && styles.pressed,
      ]}
      onPress={() => {
        if (disabled || loading) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(reportCatch('components.renova.PrimaryButton.1'));
        onPress();
      }}
    >
      {loading ? (
        <ActivityIndicator color={isOutline || isGhost ? RenovaTheme.colors.text : RenovaTheme.colors.inverseText} />
      ) : (
        <Text
          style={[
            styles.text,
            { fontSize: pad.font },
            isSecondary && styles.textSecondary,
            isOutline && !isDanger && styles.textOutline,
            isOutline && isDanger && styles.textDangerOutline,
            variant === 'danger' && styles.textDanger,
            isGhost && styles.textGhost,
            (disabled || loading) && styles.textDisabled,
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    backgroundColor: RenovaTheme.colors.primary,
    borderRadius: RenovaTheme.radius.md,
    alignItems: 'center',
    minHeight: RenovaTheme.minTouch,
    justifyContent: 'center',
  },
  fullWidth: { alignSelf: 'stretch', width: '100%' },
  secondary: { backgroundColor: RenovaTheme.colors.surfaceMuted },
  outline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: RenovaTheme.colors.border },
  dangerOutline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: RenovaTheme.colors.dangerBorder },
  danger: { backgroundColor: RenovaTheme.colors.danger },
  ghost: { backgroundColor: 'transparent', paddingVertical: 6 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.85 },
  text: { color: RenovaTheme.colors.inverseText, fontWeight: RenovaTheme.fontWeight.semibold },
  textSecondary: { color: RenovaTheme.colors.text },
  textOutline: { color: RenovaTheme.colors.text },
  textDangerOutline: { color: RenovaTheme.colors.dangerText },
  textDanger: { color: RenovaTheme.colors.inverseText },
  textGhost: { color: RenovaTheme.colors.primaryMuted, fontSize: RenovaTheme.fontSize.caption },
  textDisabled: { color: RenovaTheme.colors.textMuted },
});
