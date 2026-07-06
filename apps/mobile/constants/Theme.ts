/** Renova UI — сдержанная slate-палитра, единый контекст */
export const RenovaTheme = {
  colors: {
    primary: '#334155',
    primaryMuted: '#64748B',
    accent: '#2563EB',
    background: '#F8FAFC',
    surface: '#FFFFFF',
    text: '#0F172A',
    textMuted: '#64748B',
    textSubtle: '#94A3B8',
    success: '#15803D',
    warning: '#B45309',
    danger: '#B91C1C',
    border: '#E2E8F0',
    borderLight: '#F1F5F9',
    tabActive: '#1E293B',
    tabInactive: '#94A3B8',
  },
  spacing: { xs: 4, sm: 8, md: 10, lg: 14, xl: 20 },
  radius: { sm: 8, md: 10, lg: 12 },
  fontSize: { hero: 22, title: 16, body: 14, caption: 12, metric: 18, tab: 9 },
} as const;

export function formatRub(amount: number): string {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(amount);
}

/** Единый стиль карточек — компактнее для одной руки */
export const card = {
  backgroundColor: RenovaTheme.colors.surface,
  borderRadius: RenovaTheme.radius.lg,
  padding: RenovaTheme.spacing.md,
  borderWidth: 1,
  borderColor: RenovaTheme.colors.border,
  marginBottom: RenovaTheme.spacing.sm,
} as const;
