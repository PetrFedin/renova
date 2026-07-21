/** Честный empty — только после успешного ответа без данных */
import type { ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <View style={s.box} accessibilityRole="summary">
      <Text style={s.title}>{title}</Text>
      {message ? <Text style={s.msg}>{message}</Text> : null}
      {action ? <View style={s.action}>{action}</View> : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: RenovaTheme.colors.textMuted,
    textAlign: 'center',
  },
  msg: {
    fontSize: 13,
    color: RenovaTheme.colors.textSubtle,
    textAlign: 'center',
    lineHeight: 18,
  },
  action: { marginTop: 8 },
});
