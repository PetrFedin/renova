/** Заголовок секции вкладки «План» */
import { View, Text, StyleSheet, type ReactNode } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';

type Props = {
  step: string;
  title: string;
  hint: string;
  who: string;
  children: ReactNode;
};

export function PlanSectionFrame({ step, title, hint, who, children }: Props) {
  return (
    <View style={s.wrap}>
      <Text style={s.step}>{step}</Text>
      <Text style={s.title}>{title}</Text>
      <Text style={s.hint}>{hint}</Text>
      <Text style={s.who}>{who}</Text>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingTop: 4 },
  step: {
    fontSize: 11,
    fontWeight: '700',
    color: RenovaTheme.colors.primary,
    marginBottom: 2,
  },
  title: { fontSize: 18, fontWeight: '800', color: RenovaTheme.colors.text, marginBottom: 4 },
  hint: { fontSize: 13, color: RenovaTheme.colors.textMuted, lineHeight: 18, marginBottom: 4 },
  who: { fontSize: 12, color: RenovaTheme.colors.textSubtle, marginBottom: 10, fontStyle: 'italic' },
});
