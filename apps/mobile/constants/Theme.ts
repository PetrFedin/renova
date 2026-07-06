/** Renova UI — design tokens (единственный источник цветов и сетки) */
export const RenovaTheme = {
  colors: {
    primary: '#334155',
    primaryPressed: '#1E293B',
    primaryMuted: '#64748B',
    accent: '#2563EB',
    accentMuted: '#DBEAFE',

    background: '#F8FAFC',
    surface: '#FFFFFF',
    surfaceMuted: '#F1F5F9',

    text: '#0F172A',
    textMuted: '#64748B',
    textSubtle: '#94A3B8',
    inverseText: '#FFFFFF',

    border: '#E2E8F0',
    borderLight: '#F1F5F9',

    success: '#15803D',
    successBg: '#F0FDF4',
    successBorder: '#BBF7D0',
    successText: '#15803D',

    warning: '#B45309',
    warningBg: '#FFFBEB',
    warningBorder: '#FDE68A',
    warningText: '#B45309',

    danger: '#B91C1C',
    dangerBg: '#FEF2F2',
    dangerBorder: '#FECACA',
    dangerText: '#B91C1C',

    info: '#1D4ED8',
    infoBg: '#EFF6FF',
    infoBorder: '#BFDBFE',
    infoText: '#1D4ED8',

    neutralBg: '#F8FAFC',
    neutralBorder: '#E2E8F0',
    neutralText: '#475569',

    tabActive: '#1E293B',
    tabInactive: '#94A3B8',
  },

  /** Сетка 4/8 — md=12, lg=16 */
  spacing: {
    xxs: 2,
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
    xxxl: 32,
  },

  radius: {
    xs: 6,
    sm: 8,
    md: 10,
    lg: 12,
    xl: 16,
    pill: 999,
  },

  fontSize: {
    display: 32,
    hero: 24,
    h1: 22,
    h2: 18,
    h3: 16,
    body: 14,
    bodySmall: 13,
    caption: 12,
    tiny: 11,
    tab: 10,
    /** @deprecated use h1 */
    title: 16,
    /** @deprecated use hero */
    metric: 18,
  },

  fontWeight: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
    extrabold: '800' as const,
  },

  shadow: {
    none: {},
    card: {
      shadowColor: '#000',
      shadowOpacity: 0.04,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 1,
    },
  },

  /** Touch targets */
  minTouch: 44,
} as const;

export function formatRub(amount: number): string {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(amount);
}

/** Базовая карточка — padding 12, radius 12 */
export const card = {
  backgroundColor: RenovaTheme.colors.surface,
  borderRadius: RenovaTheme.radius.lg,
  padding: RenovaTheme.spacing.md,
  borderWidth: 1,
  borderColor: RenovaTheme.colors.border,
  marginBottom: RenovaTheme.spacing.sm,
} as const;
