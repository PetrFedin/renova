/** Компактный индикатор здоровья проекта — только для активной фазы */
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { homeLayout } from '@/constants/homeTypography';
import type { ProjectHealthLevel } from '@/lib/domain/osTypes';

const COLORS: Record<ProjectHealthLevel, { bg: string; fg: string; border: string }> = {
  good: { bg: RenovaTheme.colors.successBg, fg: '#047857', border: RenovaTheme.colors.successBorder },
  attention: { bg: RenovaTheme.colors.warningBg, fg: RenovaTheme.colors.warning, border: RenovaTheme.colors.warningBorder },
  risk: { bg: RenovaTheme.colors.warningBg, fg: RenovaTheme.colors.warningText, border: RenovaTheme.colors.warningBorder },
  critical: { bg: RenovaTheme.colors.dangerBg, fg: RenovaTheme.colors.danger, border: RenovaTheme.colors.dangerBorder },
};

export function HomeHealthBadge({
  score,
  level,
  label,
  hidden,
}: {
  score: number;
  level: ProjectHealthLevel;
  label: string;
  hidden?: boolean;
}) {
  if (hidden) return null;
  const c = COLORS[level];
  return (
    <View style={[s.badge, { backgroundColor: c.bg, borderColor: c.border }]}>
      <Text style={[s.score, { color: c.fg }]}>{score}</Text>
      <Text style={[s.label, { color: c.fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: homeLayout.innerGap,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  score: { fontSize: 13, fontWeight: '800' },
  label: { fontSize: 12, fontWeight: '600', maxWidth: 140 },
});
