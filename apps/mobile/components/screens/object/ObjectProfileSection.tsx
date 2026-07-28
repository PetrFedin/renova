/** Секция формы профиля объекта — Clarity visual: sentence-case */
import type { ReactNode } from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { formMetaText } from '@/constants/formTypography';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';

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
  title: { ...screenTypography.section, marginTop: 0, marginBottom: 4 },
  hint: {
    ...formMetaText.caption,
    marginBottom: 6,
  },
  card: {
    ...listRowStyles.metricCell,
    alignItems: 'stretch',
    padding: RenovaTheme.spacing.md,
    gap: 8,
  },
});
