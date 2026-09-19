/**
 * Что писать в строке цены на карточке заявки.
 *
 * `pre_estimate` заявки — это согласованная цена, а не чьё-то предложение.
 * Пока заказчик никого не выбрал, её нет: сервер её больше не хранит и не
 * отдаёт неназначенному исполнителю. Раньше туда зеркалилось последнее
 * поданное предложение, и конкурент читал чужую цену прямо с доски.
 *
 * Исполнителю показываем его собственное предложение — оно приходит в
 * `quotes`, уже отфильтрованных сервером по автору.
 */
import { formatRub } from '@/constants/Theme';

export type LeadPriceInput = {
  pre_estimate?: number | null;
  quotes?: { pre_estimate: number }[] | null;
};

export function leadPriceLine(
  lead: LeadPriceInput,
  role: 'customer' | 'contractor',
): string | null {
  if (role === 'contractor') {
    const own = lead.quotes?.[0];
    if (own?.pre_estimate) return `Ваше предложение: ${formatRub(own.pre_estimate)}`;
    if (lead.pre_estimate) return `Согласовано: ${formatRub(lead.pre_estimate)}`;
    return null;
  }
  if (lead.pre_estimate) return `Согласовано: ${formatRub(lead.pre_estimate)}`;
  return null;
}
