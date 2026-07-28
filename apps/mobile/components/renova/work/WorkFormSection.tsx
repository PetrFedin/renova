/** Секция формы новой работы */
import type { ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';
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
  title: { ...screenTypography.section, marginTop: 0, marginBottom: 4 },
  hint: { ...formMetaText.caption, marginBottom: 6 },
  body: { ...listRowStyles.metricCell, alignItems: 'stretch', padding: 12, gap: 8 },
});
