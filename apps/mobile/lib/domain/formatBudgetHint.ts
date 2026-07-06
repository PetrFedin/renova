/** Подпись KPI бюджета — понятный «потрачено X% плана», без пугающего «-85%» */
import { formatRub } from '@/constants/Theme';
import { capOverrunRisk } from './projectHealth';

/** Компактная сумма для плитки KPI: 164k ₽ */
export function formatRubCompact(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) {
    const m = Math.round(abs / 100_000) / 10;
    return `${amount < 0 ? '−' : ''}${m}M ₽`;
  }
  if (abs >= 1000) {
    const k = Math.round(abs / 100) / 10;
    return `${amount < 0 ? '−' : ''}${k}k ₽`;
  }
  return formatRub(amount);
}

/** Значение плитки «Бюджет» — процент освоения */
export function formatBudgetKpiValue(spent: number, planned: number): string {
  if (planned <= 0) return '—';
  return `${Math.round((spent / planned) * 100)}%`;
}

export function formatBudgetKpiHint(spent: number, planned: number): string {
  if (planned <= 0) return 'план не задан';
  const remaining = Math.max(0, planned - spent);
  return `осталось ${formatRub(remaining)}`;
}

/** KPI бюджета — сумма + навигация (hero = оплатить, KPI = смотреть план) */
export function formatBudgetKpiTileHint(spent: number, planned: number): string {
  const base = formatBudgetKpiHint(spent, planned);
  if (planned <= 0) return base;
  return `${base} · ${formatBudgetKpiNavHint()}`;
}

/** Подпись KPI бюджета — навигация, не действие */
export function formatBudgetKpiNavHint(): string {
  return 'смотреть план';
}

/** Текст риска перерасхода для экрана бюджета */
export function formatForecastOverLabel(forecastOver: number, planned: number): string | null {
  const capped = capOverrunRisk(forecastOver, planned);
  if (capped <= 0) return null;
  if (forecastOver > capped) {
    return `Возможный перерасход до ${formatRub(capped)} (ранний этап проекта)`;
  }
  return `Риск перерасхода: ${formatRub(capped)}`;
}
