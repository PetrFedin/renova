/** Форма гарантийного обращения (QLT-006): тема и описание дефекта вводит заказчик, а не шаблон. */
export const WARRANTY_TITLE_MAX = 200;
export const WARRANTY_DESCRIPTION_MAX = 4000;
export const WARRANTY_COMMENT_MAX = 1000;

export type WarrantyFormValue = { title: string; description: string };
export type WarrantyFormResult =
  | { ok: true; value: WarrantyFormValue }
  | { ok: false; error: 'title_required' | 'description_required' };

function squash(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeWarrantyForm(titleRaw: string, descriptionRaw: string): WarrantyFormResult {
  const title = squash(titleRaw).slice(0, WARRANTY_TITLE_MAX);
  const description = descriptionRaw.trim().slice(0, WARRANTY_DESCRIPTION_MAX);
  if (title.length < 3) return { ok: false, error: 'title_required' };
  if (description.length < 5) return { ok: false, error: 'description_required' };
  return { ok: true, value: { title, description } };
}

/** Комментарий к ответу/повторному открытию: пробелы схлопнуты, длина ограничена; пусто → undefined. */
export function normalizeWarrantyComment(raw: string): string | undefined {
  const clean = squash(raw).slice(0, WARRANTY_COMMENT_MAX);
  return clean || undefined;
}
