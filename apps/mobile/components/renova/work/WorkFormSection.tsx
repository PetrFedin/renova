/** Секция формы новой работы */
import { View, Text, StyleSheet, type ReactNode } from 'react-native';
import { RenovaTheme, card } from '@/constants/Theme';
import { formMetaText } from '@/constants/formTypography';

export function WorkFormSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <View style={s.wrap}>
      <Text style={s.title}>{title}</Text>
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
      <View style={s.body}>{children}</View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 12 },
  title: {
    fontSize: 12,
    fontWeight: '700',
    color: RenovaTheme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  hint: { ...formMetaText.caption, marginBottom: 6 },
  body: { ...card, padding: 12, gap: 8 },
});
