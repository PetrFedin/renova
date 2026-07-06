/** Типографика главной Renova OS — компактная шкала для профессионального UI */
import { StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';

export const homeTypography = StyleSheet.create({
  homeTitle: { fontSize: 17, fontWeight: '600', color: RenovaTheme.colors.text, letterSpacing: -0.2 },
  homeSubtitle: { fontSize: 12, fontWeight: '500', color: RenovaTheme.colors.textMuted },
  zoneLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: RenovaTheme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.35,
  },
  heroTitle: { fontSize: 15, fontWeight: '600', color: RenovaTheme.colors.text, lineHeight: 20 },
  heroSub: { fontSize: 12, fontWeight: '400', color: RenovaTheme.colors.textMuted, lineHeight: 16 },
  actionRow: { fontSize: 13, fontWeight: '500', color: RenovaTheme.colors.text },
  actionRowMuted: { fontSize: 13, fontWeight: '400', color: RenovaTheme.colors.textMuted },
  emptyState: { fontSize: 12, fontWeight: '400', color: RenovaTheme.colors.textSubtle },
  kpiValue: { fontSize: 17, fontWeight: '700', color: RenovaTheme.colors.text, lineHeight: 20 },
  kpiHint: { fontSize: 10, fontWeight: '400', color: RenovaTheme.colors.textSubtle, lineHeight: 13 },
  link: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.accent },
});

/** Отступы главной — плотнее, touch-target ≥ 40px */
export const homeLayout = {
  screenPadding: 16,
  sectionGap: 12,
  innerGap: 6,
  zoneBottom: 12,
  heroCardPadding: 12,
  heroCardRadius: 12,
  linkRowPaddingV: 7,
  linkRowPaddingH: 2,
  linkRowMinHeight: 40,
} as const;

export const homeRowStyles = StyleSheet.create({
  zone: { marginBottom: homeLayout.sectionGap },
  zoneHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: homeLayout.innerGap,
  },
  zoneTitleOnly: { marginBottom: homeLayout.innerGap },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: homeLayout.linkRowPaddingV,
    paddingHorizontal: homeLayout.linkRowPaddingH,
    gap: homeLayout.innerGap,
    minHeight: homeLayout.linkRowMinHeight,
  },
  linkRowLeading: { flex: 1, minWidth: 0 },
});
