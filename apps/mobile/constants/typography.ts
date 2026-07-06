/** Единая типографическая шкала Renova */
import { StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';

const c = RenovaTheme.colors;
const fs = RenovaTheme.fontSize;
const fw = RenovaTheme.fontWeight;

export const typography = StyleSheet.create({
  display: { fontSize: fs.display, fontWeight: fw.extrabold, color: c.text, letterSpacing: -0.5 },
  hero: { fontSize: fs.hero, fontWeight: fw.bold, color: c.text },
  h1: { fontSize: fs.h1, fontWeight: fw.bold, color: c.text, letterSpacing: -0.3 },
  h2: { fontSize: fs.h2, fontWeight: fw.extrabold, color: c.text },
  h3: { fontSize: fs.h3, fontWeight: fw.semibold, color: c.text },
  body: { fontSize: fs.body, fontWeight: fw.regular, color: c.text, lineHeight: 20 },
  bodySemibold: { fontSize: fs.body, fontWeight: fw.semibold, color: c.text, lineHeight: 20 },
  bodySmall: { fontSize: fs.bodySmall, fontWeight: fw.regular, color: c.textMuted, lineHeight: 18 },
  caption: { fontSize: fs.caption, fontWeight: fw.medium, color: c.textMuted, lineHeight: 16 },
  captionBold: { fontSize: fs.caption, fontWeight: fw.bold, color: c.textMuted, lineHeight: 16 },
  tiny: { fontSize: fs.tiny, fontWeight: fw.semibold, color: c.textSubtle, lineHeight: 14 },
  link: { fontSize: fs.caption, fontWeight: fw.semibold, color: c.accent },
  metric: { fontSize: fs.hero, fontWeight: fw.bold, color: c.text, lineHeight: 28 },
  metricLabel: { fontSize: fs.tiny, fontWeight: fw.semibold, color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.35 },
  zoneLabel: {
    fontSize: fs.tiny,
    fontWeight: fw.semibold,
    color: c.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.35,
  },
});
