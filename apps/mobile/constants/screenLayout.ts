/** Единые отступы hub- и detail-экранов Renova OS */
import { RenovaTheme } from '@/constants/Theme';

export const screenLayout = {
  padding: RenovaTheme.spacing.lg,
  paddingBottom: 32,
  contentStyle: {
    padding: RenovaTheme.spacing.lg,
    paddingBottom: 32,
  },
} as const;

/** Заголовок секции внутри hub-вкладки */
export const hubSectionTitle = {
  fontSize: 12,
  fontWeight: '700' as const,
  color: RenovaTheme.colors.textMuted,
  textTransform: 'uppercase' as const,
  marginVertical: 8,
};
