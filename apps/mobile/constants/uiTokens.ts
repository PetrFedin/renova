/** Семантические поверхности — chip active, info/warning/danger blocks */
import { RenovaTheme } from '@/constants/Theme';

const c = RenovaTheme.colors;
const r = RenovaTheme.radius;

/** Активный chip / pill tab */
export const chipActive = {
  backgroundColor: c.infoBg,
  borderColor: c.accent,
  borderWidth: 1,
} as const;

export const chipBase = {
  backgroundColor: c.surface,
  borderColor: c.border,
  borderWidth: 1,
  borderRadius: r.pill,
} as const;

export const infoSurface = {
  backgroundColor: c.infoBg,
  borderColor: c.infoBorder,
  borderWidth: 1,
  borderRadius: r.lg,
} as const;

export const warningSurface = {
  backgroundColor: c.warningBg,
  borderColor: c.warningBorder,
  borderWidth: 1,
  borderRadius: r.lg,
} as const;

export const dangerSurface = {
  backgroundColor: c.dangerBg,
  borderColor: c.dangerBorder,
  borderWidth: 1,
  borderRadius: r.lg,
} as const;

export const successSurface = {
  backgroundColor: c.successBg,
  borderColor: c.successBorder,
  borderWidth: 1,
  borderRadius: r.lg,
} as const;

/** Поле ввода */
export const inputField = {
  minHeight: RenovaTheme.minTouch,
  borderRadius: r.md,
  borderWidth: 1,
  borderColor: c.border,
  backgroundColor: c.surface,
  paddingHorizontal: RenovaTheme.spacing.md,
  fontSize: RenovaTheme.fontSize.body,
} as const;
