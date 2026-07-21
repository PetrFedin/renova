/** Секция профиля: заголовок + описание + карточка с содержимым */
import type { ReactNode } from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import { RenovaTheme, card } from '@/constants/Theme';
import { formMetaText } from '@/constants/formTypography';

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
    borderWidth: 1,
    borderColor: RenovaTheme.colors.infoBorder,
  },
  title: {
    fontSize: 12,
    fontWeight: '700',
    color: RenovaTheme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  desc: {
    ...formMetaText.caption,
    marginBottom: 8,
  },
  card: {
    ...card,
    padding: RenovaTheme.spacing.md,
    gap: 4,
  },
});
