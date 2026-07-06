/** Режим wizard: быстрый (1 мин) или подробный (комнаты поштучно) */
export type WizardMode = 'quick' | 'detailed';

export const WIZARD_MODE_LABEL: Record<WizardMode, string> = {
  quick: 'Быстро (~1 мин)',
  detailed: 'Подробно',
};

export const DEFAULT_QUICK_AREA = {
  apartment: 45,
  house: 120,
} as const;
