/** Подсказки для поиска из снимка главной — связь шапки с контентом экрана */
import type { ProjectOsSnapshot } from './osTypes';

export function buildHomeSearchHints(snap: ProjectOsSnapshot): string[] {
  const out: string[] = ['профиль', 'профиль объекта'];
  const next = snap.nextAction.title.toLowerCase();

  if (snap.pendingPayments > 0 || next.includes('оплат')) {
    out.push('оплатить', 'оплата');
  }
  if (snap.materials.needBuy > 0) out.push('материалы');
  if (snap.quality.awaitingAcceptance > 0) out.push('приёмка');
  if (snap.schedule.overdueCount && snap.schedule.overdueCount > 0) out.push('просрочка');
  if (snap.budget.planned > 0 && snap.budget.spent / snap.budget.planned < 0.25) out.push('расходы');
  if (next.includes('принять') || next.includes('приём')) out.push('этапы');
  if (snap.isComplete && snap.pendingPayments === 0) out.push('отчёты');

  return [...new Set(out)].slice(0, 5);
}
