/**
 * Подпись под именем исполнителя в каталоге.
 *
 * Вынесено из `ContractorDirectory`, чтобы проверять без рендера RN —
 * так же, как остальные подписи в `lib/domain`.
 */
export type ContractorMetaInput = {
  /** `null` — оценок никто не ставил; системы отзывов ещё нет. */
  rating?: number | null;
  /** `null` — сданные объекты никто не считает. */
  jobs_done?: number | null;
  specialties?: string | null;
};

/** Текст, который видит заказчик при выборе исполнителя. */
export function contractorMeta(c: ContractorMetaInput): string {
  const parts: string[] = [];
  // «★5» у всех означало не пятёрку, а отсутствие оценок: колонка со
  // значением по умолчанию, которую никто никогда не писал. Заказчик читал
  // это как отзывы других заказчиков — и выбирал по выдуманному числу.
  parts.push(typeof c.rating === 'number' ? `★${c.rating}` : 'Оценок пока нет');
  if (c.specialties) parts.push(c.specialties.split(',')[0]?.trim() || c.specialties);
  // Ноль читается как «сдал ноль объектов»; мы этого не знаем.
  if (typeof c.jobs_done === 'number' && c.jobs_done > 0) parts.push(`${c.jobs_done} объектов`);
  return parts.join(' · ');
}
