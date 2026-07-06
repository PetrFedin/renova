/** Статус pill — единый язык planned/active/warning/danger/done */
import { Text, View, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const toneStyle: Record<StatusTone, { bg: string; border: string; text: string }> = {
  neutral: {
    bg: RenovaTheme.colors.neutralBg,
    border: RenovaTheme.colors.neutralBorder,
    text: RenovaTheme.colors.neutralText,
  },
  info: {
    bg: RenovaTheme.colors.infoBg,
    border: RenovaTheme.colors.infoBorder,
    text: RenovaTheme.colors.infoText,
  },
  success: {
    bg: RenovaTheme.colors.successBg,
    border: RenovaTheme.colors.successBorder,
    text: RenovaTheme.colors.successText,
  },
  warning: {
    bg: RenovaTheme.colors.warningBg,
    border: RenovaTheme.colors.warningBorder,
    text: RenovaTheme.colors.warningText,
  },
  danger: {
    bg: RenovaTheme.colors.dangerBg,
    border: RenovaTheme.colors.dangerBorder,
    text: RenovaTheme.colors.dangerText,
  },
};

export function StatusPill({ label, tone = 'neutral' }: { label: string; tone?: StatusTone }) {
  const t = toneStyle[tone];
  return (
    <View style={[s.pill, { backgroundColor: t.bg, borderColor: t.border }]}>
      <Text style={[s.text, { color: t.text }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: RenovaTheme.spacing.sm,
    paddingVertical: 4,
    borderRadius: RenovaTheme.radius.pill,
    borderWidth: 1,
    minHeight: 24,
    justifyContent: 'center',
  },
  text: { fontSize: RenovaTheme.fontSize.tiny, fontWeight: RenovaTheme.fontWeight.bold },
});
