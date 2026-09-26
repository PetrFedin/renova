/**
 * How a budget deviation is written out.
 *
 * Server semantics: a positive deviation means fact is above plan. So a
 * negative one is money not spent — a saving.
 *
 * The screen names that direction in the label and then used to repeat it in
 * the value:
 *
 *     Экономия  −185 938 ₽
 *
 * which reads as a saving of minus the whole budget. It appeared in green
 * under «В пределах плана», on a project where nothing had been spent yet —
 * i.e. exactly when the number is at its largest and the framing most
 * reassuring.
 *
 * A direction stated twice is a direction reversed. The label keeps it; the
 * value carries the magnitude. Only the neutral label keeps a signed value,
 * and there the value is zero anyway.
 */
import { formatRub } from '@/constants/Theme';

export function formatDeviationLabel(deviation: number): string {
  if (deviation > 0) return 'Перерасход';
  if (deviation < 0) return 'Экономия';
  return 'Отклонение';
}

export function formatDeviationValue(deviation: number): string {
  if (deviation === 0 || !Number.isFinite(deviation)) return formatRub(0);
  return formatRub(Math.abs(deviation));
}
