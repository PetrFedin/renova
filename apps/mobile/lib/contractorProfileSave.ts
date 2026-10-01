/** Сохранение реквизитов исполнителя: не затираем серверные данные при сбое загрузки (CMP-010). */
export type ProfileLoadState = 'loading' | 'ready' | 'error';
export type RequisitesFields = { company_name: string; payment_requisites: string };

export function canSaveProfile(state: ProfileLoadState): boolean {
  return state === 'ready';
}

/** Только изменённые поля (PATCH-семантика); пустая строка у изменённого поля → null (очистка). */
export function buildRequisitesPatch(
  baseline: RequisitesFields,
  current: RequisitesFields,
): Partial<Record<keyof RequisitesFields, string | null>> {
  const patch: Partial<Record<keyof RequisitesFields, string | null>> = {};
  (['company_name', 'payment_requisites'] as const).forEach((key) => {
    const next = current[key].trim();
    if (next !== baseline[key].trim()) patch[key] = next === '' ? null : next;
  });
  return patch;
}
