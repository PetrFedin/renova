/** Секция профиля: заголовок + описание + карточка с содержимым */
import { View, Text, StyleSheet, type ReactNode, type ViewStyle } from 'react-native';
import { RenovaTheme, card } from '@/constants/Theme';

type Props = {
  title: string;
  description?: string;
  children: ReactNode;
  /** Без карточки — для inline-блоков (роль, портфель) */
  bare?: boolean;
  style?: ViewStyle;
};

export function ProfileSection({ title, description, children, bare, style }: Props) {
  return (
    <View style={[s.wrap, style]}>
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
  title: {
    fontSize: 12,
    fontWeight: '700',
    color: RenovaTheme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  desc: {
    fontSize: 12,
    color: RenovaTheme.colors.textMuted,
    lineHeight: 17,
    marginBottom: 8,
  },
  card: {
    ...card,
    padding: RenovaTheme.spacing.md,
    gap: 4,
  },
});
