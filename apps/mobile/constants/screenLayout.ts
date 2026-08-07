/** Единые отступы hub- и detail-экранов Renova OS */
import { RenovaTheme } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';

export const screenLayout = {
  padding: RenovaTheme.spacing.lg,
  paddingBottom: 32,
  screen: {
    flex: 1,
    padding: RenovaTheme.spacing.lg,
  },
  contentStyle: {
    padding: RenovaTheme.spacing.lg,
    paddingBottom: 32,
  },
} as const;

/** Clarity P: alias на SoT section — без uppercase-крика */
export const hubSectionTitle = screenTypography.section;