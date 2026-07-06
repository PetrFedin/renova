/** Базовые контейнеры Renova — base | action | status | metric */
import type { ReactNode } from 'react';
import { View, Pressable, StyleSheet, type ViewStyle } from 'react-native';
import { RenovaTheme, card as baseCard } from '@/constants/Theme';
import { dangerSurface, infoSurface, successSurface, warningSurface } from '@/constants/uiTokens';

type Variant = 'base' | 'action' | 'info' | 'warning' | 'danger' | 'success' | 'metric';

const surfaceByVariant: Record<Exclude<Variant, 'base' | 'action' | 'metric'>, ViewStyle> = {
  info: infoSurface,
  warning: warningSurface,
  danger: dangerSurface,
  success: successSurface,
};

type Props = {
  children: ReactNode;
  variant?: Variant;
  style?: ViewStyle;
  onPress?: () => void;
};

export function Card({ children, variant = 'base', style, onPress }: Props) {
  const surface =
    variant === 'base' || variant === 'action' || variant === 'metric'
      ? baseCard
      : { ...baseCard, ...surfaceByVariant[variant] };

  const boxStyle = [
    surface,
    variant === 'metric' && s.metric,
    variant === 'action' && s.action,
    style,
  ];

  if (onPress) {
    return (
      <Pressable
        style={({ pressed }) => [boxStyle, pressed && s.pressed]}
        onPress={onPress}
        accessibilityRole="button"
      >
        {children}
      </Pressable>
    );
  }

  return <View style={boxStyle}>{children}</View>;
}

const s = StyleSheet.create({
  metric: { paddingVertical: RenovaTheme.spacing.sm, alignItems: 'center' },
  action: { minHeight: 64, justifyContent: 'center' },
  pressed: { opacity: 0.88 },
});
