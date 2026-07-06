/** Обрезка нереалистичных сумм в тексте риска (баг данных демо) */
import { formatRub } from '@/constants/Theme';

const MAX_REASONABLE = 50_000_000;

export function sanitizeRiskImpact(text: string, plannedBudget = 0): string {
  if (!text) return text;
  const cap = plannedBudget > 0 ? Math.max(plannedBudget * 3, 500_000) : MAX_REASONABLE;
  return text.replace(/\+?\s*([\d\s.,]+)\s*₽/g, (full, numRaw) => {
    const num = Number(String(numRaw).replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(num) || num <= cap) return full;
    return `+${formatRub(Math.min(num, cap))} (оценка)`;
  });
}
