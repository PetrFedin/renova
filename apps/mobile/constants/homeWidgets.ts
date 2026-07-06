/** Виджеты главной — каталог для настроек отображения */
import type { OsRole } from '@/constants/osSections';

export type HomeWidgetId =
  | 'health_next'
  | 'insights'
  | 'kpi_budget'
  | 'kpi_schedule'
  | 'kpi_materials'
  | 'kpi_quality'
  | 'sites'
  | 'schedule'
  | 'risks'
  | 'works_materials'
  | 'documents'
  | 'activity'
  | 'portfolio'
  | 'budget_alerts'
  | 'inbox';

export type HomeWidgetDef = {
  id: HomeWidgetId;
  label: string;
  hint?: string;
  group: 'main' | 'kpi' | 'lists';
  /** Скрыть из каталога настроек — дубль другого входа */
  hidden?: boolean;
};

export const HOME_WIDGET_CATALOG: HomeWidgetDef[] = [
  { id: 'health_next', label: 'Сделать сейчас: главное действие', group: 'main' },
  { id: 'insights', label: 'Подсказки в «Сделать сейчас»', hint: 'если входящих нет', group: 'main' },
  { id: 'kpi_budget', label: 'Сводка: Бюджет', group: 'kpi' },
  { id: 'kpi_schedule', label: 'Сводка: Сроки', group: 'kpi' },
  { id: 'kpi_materials', label: 'Сводка: Материалы', group: 'kpi' },
  { id: 'kpi_quality', label: 'Сводка: Качество', group: 'kpi' },
  { id: 'portfolio', label: 'Ссылка «Все проекты»', hint: 'дубль picker — используйте выбор в шапке', group: 'main', hidden: true },
  { id: 'budget_alerts', label: 'Превышение бюджета по комнатам', group: 'lists' },
  { id: 'inbox', label: 'Входящие в «Сделать сейчас»', hint: 'дублирует hero — используйте меню ↑', group: 'main', hidden: true },
  { id: 'sites', label: 'Площадки и циклы', group: 'main' },
  { id: 'schedule', label: 'План на неделю', group: 'main' },
  { id: 'risks', label: 'Риски', group: 'lists' },
  { id: 'works_materials', label: 'Работы и материалы', group: 'lists' },
  { id: 'documents', label: 'Кнопка «Документы»', hint: 'дубль меню ↑ — используйте меню или профиль', group: 'lists', hidden: true },
  { id: 'activity', label: 'Недавнее', hint: 'в блоке «Ещё»', group: 'lists' },
];

/** Рекомендуемый набор по анализу главной (п. C) */
export const HOME_WIDGET_STANDARD: HomeWidgetId[] = [
  'health_next',
  'kpi_budget',
  'kpi_schedule',
  'kpi_materials',
  'kpi_quality',
  'schedule',
  'activity',
];

/** Пресеты глубины главной (P3) */
export type HomeWidgetPresetId = 'brief' | 'standard' | 'detailed';

export const HOME_WIDGET_PRESETS: Record<HomeWidgetPresetId, { label: string; hint: string; ids: HomeWidgetId[] }> = {
  brief: {
    label: 'Кратко',
    hint: 'Срочное + сводка, без дубля «Сообщений»',
    ids: ['health_next', 'kpi_budget', 'kpi_schedule', 'kpi_materials', 'kpi_quality', 'schedule'],
  },
  standard: {
    label: 'Стандарт',
    hint: 'Рекомендуемый вид',
    ids: [...HOME_WIDGET_STANDARD],
  },
  detailed: {
    label: 'Подробно',
    hint: 'Все блоки + «Ещё»',
    ids: [
      ...HOME_WIDGET_STANDARD,
      'budget_alerts',
      'sites',
      'risks',
      'works_materials',
      'insights',
    ],
  },
};

/** Для новых пользователей и «Сбросить к стандарту» — краткий вид без шума */
export const HOME_WIDGET_DEFAULT: HomeWidgetId[] = [...HOME_WIDGET_PRESETS.brief.ids];

export const HOME_WIDGET_GROUP_LABEL: Record<HomeWidgetDef['group'], string> = {
  main: 'Основные',
  kpi: 'Сводка (2×2)',
  lists: 'Списки и действия',
};

export type HomeWidgetRole = OsRole;
