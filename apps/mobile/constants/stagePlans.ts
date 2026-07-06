/** Планы этапов — синхрон с backend STANDARD_RENOVA_STAGES §4.3 */
export const STANDARD_STAGES = [
  'Подготовка', 'Демонтаж', 'Черновые работы', 'Инженерные системы', 'Стены', 'Пол', 'Потолок',
  'Чистовая отделка', 'Освещение', 'Сантехника', 'Мебель', 'Уборка', 'Приёмка', 'Завершение проекта',
];

export const STAGE_PLAN_LABELS: Record<string, { title: string; stages: string[] }> = {
  cosmetic: { title: 'Косметический', stages: ['Подготовка', 'Демонтаж', 'Черновые работы', 'Стены', 'Пол', 'Чистовая отделка', 'Приёмка', 'Завершение проекта'] },
  capital: { title: 'Капитальный', stages: STANDARD_STAGES },
  bathroom: { title: 'Ванная/санузел', stages: ['Подготовка', 'Демонтаж', 'Черновые работы', 'Инженерные системы', 'Стены', 'Пол', 'Чистовая отделка', 'Сантехника', 'Приёмка', 'Завершение проекта'] },
  kitchen: { title: 'Кухня', stages: ['Подготовка', 'Демонтаж', 'Черновые работы', 'Инженерные системы', 'Стены', 'Пол', 'Чистовая отделка', 'Мебель', 'Приёмка'] },
};

export const DISPLAY_STATUS_LABELS: Record<string, string> = {
  not_started: 'Не начат', preparation: 'Подготовка', in_progress: 'В работе', paused: 'На паузе',
  waiting_materials: 'Ожидает материалы', waiting_acceptance: 'Ожидает приёмку', completed: 'Завершён', archive: 'Архив',
};

export function stagePlanLabel(type: string) { return STAGE_PLAN_LABELS[type]?.title ?? type; }
