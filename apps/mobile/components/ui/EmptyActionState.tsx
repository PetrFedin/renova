/** Clarity B/C: пустое состояние — одна фраза + один CTA, без тяжёлой card */
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';
import { PrimaryButton } from '@/components/renova/PrimaryButton';

type Props = {
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionVariant?: 'primary' | 'outline';
};

export function EmptyActionState({
  title,
  hint,
  actionLabel,
  onAction,
  actionVariant = 'outline',
}: Props) {
  return (
    <View style={s.wrap}>
      <Text style={s.title}>{title}</Text>
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
      {actionLabel && onAction ? (
        <View style={s.action}>
          <PrimaryButton title={actionLabel} variant={actionVariant} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    paddingVertical: 14,
    paddingHorizontal: 4,
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: RenovaTheme.colors.border,
    marginBottom: 12,
  },
  title: { ...screenTypography.listTitle },
  hint: { ...screenTypography.empty },
  action: { marginTop: 6 },
});
