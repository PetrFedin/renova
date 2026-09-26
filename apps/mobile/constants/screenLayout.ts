/** Единые отступы hub- и detail-экранов Renova OS */
import { FAB_SAFE_BOTTOM } from '@/constants/fab';
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
  /**
   * Для экранов вкладок: поверх них лежит плавающая кнопка быстрых действий,
   * и её место нужно оставить свободным — иначе низ содержимого оказывается
   * под ней и нажимается кнопка, а не то, что видно.
   *
   * Экранам стека этот запас не нужен: там кнопки нет, и лишние 150 точек
   * пустоты внизу были бы заметны.
   */
  tabContentStyle: {
    padding: RenovaTheme.spacing.lg,
    paddingBottom: FAB_SAFE_BOTTOM,
  },
} as const;

/** Clarity P: alias на SoT section — без uppercase-крика */
export const hubSectionTitle = screenTypography.section;