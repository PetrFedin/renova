/** Единое пустое состояние: иконка, короткий заголовок, «что это и зачем», один CTA и необязательная ссылка */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RenovaTheme } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';
import { homeTypography } from '@/constants/homeTypography';
import { PrimaryButton } from '@/components/renova/PrimaryButton';

type Props = {
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionVariant?: 'primary' | 'accent' | 'outline';
  /** Ionicons; по умолчанию нейтральная «пустая папка» */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Второстепенное действие — текстовая ссылка под CTA */
  secondaryLabel?: string;
  onSecondary?: () => void;
};

export function EmptyActionState({
  title,
  hint,
  actionLabel,
  onAction,
  actionVariant = 'outline',
  icon = 'file-tray-outline',
  secondaryLabel,
  onSecondary,
}: Props) {
  return (
    <View style={s.wrap}>
      <View style={s.iconWrap}>
        <Ionicons name={icon} size={22} color={RenovaTheme.colors.accent} />
      </View>
      <Text style={s.title}>{title}</Text>
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
      {actionLabel && onAction ? (
        <View style={s.action}>
          <PrimaryButton title={actionLabel} variant={actionVariant} onPress={onAction} />
        </View>
      ) : null}
      {secondaryLabel && onSecondary ? (
        <Pressable onPress={onSecondary} hitSlop={8} accessibilityRole="button" style={s.secondary}>
          <Text style={homeTypography.link}>{secondaryLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 16,
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RenovaTheme.radius.lg,
    borderColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surfaceMuted,
    marginBottom: 12,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: RenovaTheme.colors.accentMuted,
    marginBottom: 2,
  },
  title: { ...screenTypography.listTitle, textAlign: 'center' },
  hint: { ...screenTypography.empty, textAlign: 'center' },
  action: { marginTop: 8, alignSelf: 'stretch' },
  secondary: { marginTop: 6, paddingVertical: 4 },
});
