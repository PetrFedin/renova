/** Заголовок секции вкладки «План» — Clarity C: короче, без «who»-шума */
import type { ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';

type Props = {
  step: string;
  title: string;
  hint: string;
  who: string;
  children: ReactNode;
};

export function PlanSectionFrame({ title, hint, children }: Props) {
  return (
    <View style={s.wrap}>
      <Text style={s.title}>{title}</Text>
      <Text style={s.hint} numberOfLines={2}>
        {hint}
      </Text>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingTop: 4 },
  title: { fontSize: 17, fontWeight: '700', color: RenovaTheme.colors.text, marginBottom: 4 },
  hint: { ...screenTypography.listMeta, marginBottom: 10 },
});
