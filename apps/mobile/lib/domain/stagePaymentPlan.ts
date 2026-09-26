/**
 * Разбор ввода сумм и объяснение сходимости порядка оплаты.
 *
 * Вынесено из панели, чтобы проверять без рендера RN — так же, как остальные
 * подписи и разборы в `lib/domain`.
 */
import { formatRub } from '@/constants/Theme';

/** Ввод денег: принимаем запятую как разделитель и отбрасываем мусор. */
export function parseAmountInput(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, '').replace(',', '.');
  if (!cleaned) return 0;
  if (!/^\d*\.?\d*$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;
}

/**
 * Что сказать про сходимость — словами, а не флагом.
 *
 * «Не сходится» без суммы не говорит, насколько именно, и не объясняет
 * последствие: по нераспределённым деньгам платежей не возникнет вовсе.
 */
export function undistributedNote(plan: { undistributed: number }): string | null {
  const left = plan.undistributed;
  if (Math.abs(left) < 0.01) return null;
  return left > 0
    ? `Не разнесено ${formatRub(left)} — по этим деньгам платежей не возникнет`
    : `Разнесено на ${formatRub(Math.abs(left))} больше цены договора`;
}
