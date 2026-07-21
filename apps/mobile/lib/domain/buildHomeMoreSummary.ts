/** Сводка и проверка контента для блока «Ещё» на главной */
import type { BudgetAlert } from '@/components/renova/BudgetAlerts';
import type { HomeWidgetId } from '@/constants/homeWidgets';
import type { MaterialPick, ProjectDetail, ReceiptItem } from '@/lib/api';
import { formatCount, RU_NOUN } from '../i18n';
import { buildProjectSites } from './projectSites';
import type { ProjectOsSnapshot } from './osTypes';

type Args = {
  snap: ProjectOsSnapshot;
  project: ProjectDetail;
  budgetAlerts: BudgetAlert[];
  receipts: ReceiptItem[];
  picks: MaterialPick[];
  isVisible: (id: HomeWidgetId) => boolean;
};

/** Склонение «N риск/риска/рисков» */
export function formatRiskCount(n: number): string {
  return formatCount(n, RU_NOUN.risk);
}

export function buildHomeMoreSummary({ snap, project, budgetAlerts, receipts, picks, isVisible }: Args): string {
  const parts: string[] = [];
  const sites = buildProjectSites(project, receipts, picks);

  if (isVisible('budget_alerts') && budgetAlerts.some((i) => i.fact > i.plan && i.plan > 0)) {
    parts.push('бюджет');
  }
  if (isVisible('sites') && sites.length > 1) {
    parts.push('площадки');
  }
  if (isVisible('risks') && snap.risks.length > 0) {
    parts.push(formatRiskCount(snap.risks.length));
  }
  if (isVisible('documents')) parts.push('документы');
  if (isVisible('activity')) parts.push('недавнее');

  return parts.join(' · ');
}

/** Есть ли реальный контент внутри «Ещё» (не только summary-строка) */
export function homeMoreHasVisibleContent({ snap, project, budgetAlerts, receipts, picks, isVisible }: Args): boolean {
  const sites = buildProjectSites(project, receipts, picks);

  if (isVisible('budget_alerts') && budgetAlerts.some((i) => i.fact > i.plan && i.plan > 0)) return true;
  if (isVisible('sites') && sites.length > 1) return true;
  if (isVisible('risks') && snap.risks.length > 0) return true;
  if (isVisible('documents')) return true;
  if (isVisible('activity')) return true;
  return false;
}
