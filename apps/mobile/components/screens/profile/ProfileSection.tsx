/** Секция профиля: заголовок + описание + спокойный контейнер — Clarity visual */
import type { ReactNode } from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { formMetaText } from '@/constants/formTypography';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';

type Props = {
  title: string;
  description?: string;
  children: ReactNode;
  /** Без карточки — для inline-блоков (роль, портфель) */
  bare?: boolean;
  /** Подсветка секции при deep link (focus=contractor) */
  highlight?: boolean;
  style?: ViewStyle;
};

export function ProfileSection({ title, description, children, bare, highlight, style }: Props) {
  return (
    <View style={[s.wrap, highlight && s.wrapHighlight, style]}>
      <Text style={s.title}>{title}</Text>
      {description ? <Text style={s.desc}>{description}</Text> : null}
      {bare ? children : <View style={s.card}>{children}</View>}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    marginTop: 20,
  },
  wrapHighlight: {
    marginTop: 12,
    padding: 8,
    borderRadius: RenovaTheme.radius.md,
    backgroundColor: RenovaTheme.colors.infoBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: RenovaTheme.colors.infoBorder,
  },
  title: { ...screenTypography.section, marginTop: 0, marginBottom: 6 },
  desc: {
    ...formMetaText.caption,
    marginBottom: 8,
  },
  card: {
    ...listRowStyles.metricCell,
    alignItems: 'stretch',
    padding: RenovaTheme.spacing.md,
    gap: 4,
  },
});
