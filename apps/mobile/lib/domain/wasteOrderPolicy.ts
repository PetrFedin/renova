/**
 * Вывоз мусора (APIB-012, EST-015, EST-016): кто что может и как вводится заявка.
 * Зеркало backend `waste_order_service.validate_transition`.
 */
import { parseNonNegativeNumber, parsePositiveNumber } from '@/lib/parseLocaleNumber';

export const WASTE_STATUS_LABEL: Record<string, string> = {
  draft: 'Черновик',
  requested: 'Ждёт согласования',
  scheduled: 'Согласован',
  done: 'Вывезен',
  cancelled: 'Отменён',
};

/** Подпись даты вывоза: «Согласован» без даты не оставляем без пояснения. */
export function wasteDateLabel(
  order: { status: string; scheduled_date?: string | null },
  formatDay: (iso: string) => string,
): string | null {
  const date = order.scheduled_date?.trim();
  if (date) return `Дата вывоза: ${formatDay(date)}`;
  if (order.status === 'scheduled') return 'Дата не назначена';
  return null;
}

export type WasteActions = {
  create: boolean;
  request: boolean;
  approve: boolean;
  complete: boolean;
  cancel: boolean;
};

/**
 * В проекте без исполнителя (self-managed) заказчик сам заказывает и закрывает вывоз —
 * иначе заявка оказывалась в тупике.
 */
export function wasteActions(role: string, selfManaged: boolean, status: string): WasteActions {
  const customer = role === 'customer';
  const executor = role === 'contractor' || (customer && selfManaged);
  return {
    create: executor,
    request: executor && status === 'draft',
    approve: customer && status === 'requested',
    complete: executor && status === 'scheduled',
    cancel: customer
      ? status === 'draft' || status === 'requested' || status === 'scheduled'
      : executor && (status === 'draft' || status === 'requested'),
  };
}

export type WasteFormResult =
  | { ok: true; volume_m3: number; price: number; total: number }
  | { ok: false; title: string; message: string };

/** price — цена за 1 м³ (итог = объём x цена), поэтому форма показывает итог до отправки. */
export function parseWasteForm(volumeText: string, pricePerM3Text: string): WasteFormResult {
  const volume = parsePositiveNumber(volumeText);
  if (volume === null) {
    return { ok: false, title: 'Объём вывоза', message: 'Введите объём в м³ числом больше 0, например 8.' };
  }
  const price = pricePerM3Text.trim() ? parseNonNegativeNumber(pricePerM3Text) : 0;
  if (price === null) {
    return { ok: false, title: 'Цена вывоза', message: 'Введите цену за 1 м³ числом от 0, например 560.' };
  }
  return { ok: true, volume_m3: volume, price, total: Math.round(volume * price * 100) / 100 };
}
