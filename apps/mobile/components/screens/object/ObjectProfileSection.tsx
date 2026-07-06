/** Секция формы профиля объекта — единый ритм заголовков и карточек */
import { View, Text, StyleSheet, type ReactNode, type ViewStyle } from 'react-native';
import { RenovaTheme, card } from '@/constants/Theme';

type Props = {
  title: string;
  hint?: string;
  children: ReactNode;
  style?: ViewStyle;
};

export function ObjectProfileSection({ title, hint, children, style }: Props) {
  return (
    <View style={[s.wrap, style]}>
      <Text style={s.title}>{title}</Text>
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
      <View style={s.card}>{children}</View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 14 },
  title: {
    fontSize: 12,
    fontWeight: '700',
    color: RenovaTheme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  hint: {
    fontSize: 12,
    color: RenovaTheme.colors.textSubtle,
    lineHeight: 16,
    marginBottom: 6,
  },
  card: {
    ...card,
    padding: RenovaTheme.spacing.md,
    gap: 8,
  },
});
