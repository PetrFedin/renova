/** Сохранение профиля исполнителя: не затираем серверные данные при сбое загрузки (CMP-010, MKT-003). */
export type ProfileLoadState = 'loading' | 'ready' | 'error';
export type RequisitesFields = { company_name: string; payment_requisites: string };
export type ProfileFields = RequisitesFields & { specialties: string; city: string; bio: string };

/** Лимиты бэкенда (ProfileIn в marketplace.py). */
export const PROFILE_LIMITS: Record<keyof ProfileFields, number> = {
  company_name: 255,
  payment_requisites: 1000,
  specialties: 512,
  city: 64,
  bio: 4000,
};

const FIELD_LABELS: Record<keyof ProfileFields, string> = {
  company_name: 'Название',
  payment_requisites: 'Реквизиты',
  specialties: 'Специализации',
  city: 'Город',
  bio: 'О себе',
};

export function canSaveProfile(state: ProfileLoadState): boolean {
  return state === 'ready';
}

/** Ошибки по полям, у которых длина (после trim) превышает лимит бэкенда. */
export function validateProfileFields(
  fields: Partial<Record<keyof ProfileFields, string>>,
): Partial<Record<keyof ProfileFields, string>> {
  const errors: Partial<Record<keyof ProfileFields, string>> = {};
  (Object.keys(PROFILE_LIMITS) as (keyof ProfileFields)[]).forEach((key) => {
    const value = fields[key];
    if (value !== undefined && value.trim().length > PROFILE_LIMITS[key]) {
      errors[key] = `${FIELD_LABELS[key]}: не больше ${PROFILE_LIMITS[key]} символов (сейчас ${value.trim().length})`;
    }
  });
  return errors;
}

/**
 * Только изменённые поля (PATCH-семантика). Осознанная очистка отправляется пустой строкой:
 * бэкенд игнорирует null (null не стирает), пустая строка — стирает.
 */
export function buildRequisitesPatch<T extends Partial<Record<keyof ProfileFields, string>>>(
  baseline: T,
  current: T,
): Partial<Record<keyof T, string>> {
  const patch: Partial<Record<keyof T, string>> = {};
  (Object.keys(current) as (keyof T)[]).forEach((key) => {
    const next = String(current[key] ?? '').trim();
    if (next !== String(baseline[key] ?? '').trim()) patch[key] = next;
  });
  return patch;
}
