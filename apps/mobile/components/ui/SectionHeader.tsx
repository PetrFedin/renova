/** Заголовок секции — h2 + опциональная ссылка */
import { View, Text, StyleSheet } from 'react-native';
import { typography } from '@/constants/typography';
import { RenovaTheme } from '@/constants/Theme';
import { TextLink } from '@/components/ui/TextLink';

type Props = {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function SectionHeader({ title, subtitle, actionLabel, onAction }: Props) {
  return (
    <View style={s.wrap}>
      <View style={s.left}>
        <Text style={typography.zoneLabel}>{title}</Text>
        {subtitle ? <Text style={typography.caption}>{subtitle}</Text> : null}
      </View>
      {actionLabel && onAction ? (
        <TextLink label={actionLabel} onPress={onAction} />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: RenovaTheme.spacing.sm,
    gap: RenovaTheme.spacing.sm,
  },
  left: { flex: 1, minWidth: 0 },
});
