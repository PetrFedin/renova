/** Issue #379: plan→fact meta string for a material estimate line.
 *
 * `EstimateLine.quantity_actual` is a non-null numeric field (backend default 0):
 * an explicit 0 means "measured actual is zero", not "not entered yet". A
 * `quantity_actual || quantity_planned` fallback treats 0 as falsy and silently
 * substitutes the plan as if it were the measured fact — this must never happen.
 */
import type { EstimateLine } from '../api';

export function materialActualMeta(l: EstimateLine): string {
  const fact = l.quantity_actual;
  const overrun = l.quantity_planned ? ((fact - l.quantity_planned) / l.quantity_planned) * 100 : 0;
  return `план ${l.quantity_planned} → факт ${fact} ${l.unit}${overrun > 5 ? ` · +${overrun.toFixed(0)}%` : ''}`;
}
