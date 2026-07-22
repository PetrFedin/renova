/** Детализация KPI-плитки главной — sheet без ухода с экрана */
import { formatRub } from '../../constants/Theme';
import { budgetTabRoute, calendarTabRoute, repairTabRoute, type OsRole } from '../../constants/osSections';
import type { OsNavHref, ProjectOsSnapshot } from './osTypes';
import { formatInvoices } from '../i18n';

function formatRubCompact(amount: number): string {
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

function budgetRemainingHint(spent: number, planned: number): string {
  if (planned <= 0) return 'план не задан';
  return `осталось ${formatRub(Math.max(0, planned - spent))}`;
}

export type HomeKpiBar = { label: string; percent: number; tone?: 'good' | 'warn' | 'danger' | 'neutral' };

export type HomeKpiDetail = {
  title: string;
  lead?: string;
  rows: { label: string; value: string }[];
  bars?: HomeKpiBar[];
  actionLabel: string;
  actionHref: OsNavHref;
};

function paymentWord(count: number): string {
  return formatInvoices(count);
}

function budgetDetail(snap: ProjectOsSnapshot, role: OsRole, closing: boolean): HomeKpiDetail {
  const { planned, spent, remaining, forecast } = snap.budget;
  const pct = planned > 0 ? Math.round((spent / planned) * 100) : 0;

  if (closing) {
    return {
      title: 'Оплаты',
      lead: snap.pendingPaymentTotal > 0
        ? `${formatRub(snap.pendingPaymentTotal)} к оплате`
        : paymentWord(snap.pendingPayments),
      rows: [
        { label: 'Ожидают оплаты', value: paymentWord(snap.pendingPayments) },
        { label: 'Сумма счетов', value: snap.pendingPaymentTotal > 0 ? formatRub(snap.pendingPaymentTotal) : '—' },
        { label: 'Факт ремонта', value: formatRub(spent) },
        { label: 'План сметы', value: formatRub(planned) },
      ],
      bars: planned > 0 ? [{ label: `Освоено ${pct}% плана`, percent: Math.min(pct, 100), tone: pct > 90 ? 'warn' : 'good' }] : undefined,
      actionLabel: 'Оплатить →',
      actionHref: budgetTabRoute(role, 'payments', { openPayment: '1' }),
    };
  }

  return {
    title: 'Бюджет',
    lead: planned > 0 ? `${pct}% плана освоено` : 'План не задан',
    rows: [
      { label: 'План', value: formatRub(planned) },
      { label: 'Факт', value: formatRub(spent) },
      { label: 'Остаток', value: formatRub(remaining) },
      { label: 'Прогноз', value: formatRub(forecast) },
    ],
    bars: planned > 0 ? [{ label: `Факт ${pct}%`, percent: Math.min(pct, 100), tone: pct > 100 ? 'danger' : 'good' }] : undefined,
    actionLabel: 'Бюджет →',
    actionHref: budgetTabRoute(role, 'summary', { period: 'month', focus: 'fact' }),
  };
}

function scheduleDetail(snap: ProjectOsSnapshot, role: OsRole, closing: boolean, complete: boolean): HomeKpiDetail {
  const pct = snap.schedule.progressPercent;

  if (closing) {
    return {
      title: 'Закрытие',
      lead: 'Работы завершены — осталось закрыть оплаты',
      rows: [
        { label: 'Прогресс работ', value: '100%' },
        { label: 'Счетов к оплате', value: paymentWord(snap.pendingPayments) },
        { label: 'Сумма к оплате', value: snap.pendingPaymentTotal > 0 ? formatRub(snap.pendingPaymentTotal) : '—' },
        { label: 'Статус', value: 'Закрытие проекта' },
      ],
      bars: [{ label: 'Этапы выполнены', percent: 100, tone: 'good' }],
      actionLabel: 'Оплатить →',
      actionHref: budgetTabRoute(role, 'payments', { openPayment: '1' }),
    };
  }

  if (complete) {
    return {
      title: 'Сроки',
      lead: 'Проект завершён — закрытие и гарантия',
      rows: [
        { label: 'Прогресс', value: '100%' },
        { label: 'Статус', value: 'Завершён' },
      ],
      bars: [{ label: 'Выполнено', percent: 100, tone: 'good' }],
      // W55: closeout в Document Center, не только KPI-отчёты
      actionLabel: 'Документы →',
      actionHref: '/documents',
    };
  }

  const overdue = snap.schedule.overdueCount || 0;
  return {
    title: 'Сроки',
    lead: snap.schedule.currentStage || 'График работ',
    rows: [
      { label: 'Прогресс', value: `${pct}%` },
      { label: 'Текущий этап', value: snap.schedule.currentStage || '—' },
      { label: 'План до', value: snap.schedule.plannedEnd || '—' },
      ...(overdue > 0 ? [{ label: 'Просрочка', value: `${overdue} этап(ов)` }] : []),
    ],
    bars: [{ label: `Выполнено ${pct}%`, percent: Math.min(pct, 100), tone: overdue > 0 ? 'warn' : 'neutral' }],
    actionLabel: 'Календарь →',
    actionHref: calendarTabRoute(role),
  };
}

function materialsDetail(snap: ProjectOsSnapshot, role: OsRole): HomeKpiDetail {
  const m = snap.materials;
  return {
    title: 'Материалы',
    lead: `${m.needBuy} поз. к закупке`,
    rows: [
      { label: 'К закупке', value: String(m.needBuy) },
      { label: 'Заказано', value: String(m.ordered) },
      { label: 'Доставлено', value: String(m.delivered) },
      ...(m.shortage > 0 ? [{ label: 'Без количества', value: String(m.shortage) }] : []),
    ],
    actionLabel: 'Материалы →',
    actionHref: repairTabRoute(role, 'materials'),
  };
}

function qualityDetail(snap: ProjectOsSnapshot, role: OsRole): HomeKpiDetail {
  const q = snap.quality;
  return {
    title: 'Качество',
    lead: q.awaitingAcceptance > 0 ? `${q.awaitingAcceptance} на приёмке` : 'Контроль качества',
    rows: [
      { label: 'Ждут приёмки', value: String(q.awaitingAcceptance) },
      { label: 'Замечания', value: String(q.openIssues) },
      { label: 'Критичные', value: String(q.criticalIssues) },
    ],
    actionLabel: 'Приёмка →',
    actionHref: repairTabRoute(role, 'control'),
  };
}

export function buildHomeKpiDetail(widgetId: string, snap: ProjectOsSnapshot, role: OsRole): HomeKpiDetail | null {
  const closing = snap.isComplete && snap.pendingPayments > 0;
  const complete = snap.isComplete && snap.pendingPayments === 0;

  switch (widgetId) {
    case 'kpi_budget':
      return budgetDetail(snap, role, closing);
    case 'kpi_schedule':
      return scheduleDetail(snap, role, closing, complete);
    case 'kpi_materials':
      return materialsDetail(snap, role);
    case 'kpi_quality':
      return qualityDetail(snap, role);
    default:
      return null;
  }
}

/** Значения плиток KPI на главной — согласованы с buildHomeKpiDetail */
export function formatHomeKpiTile(
  widgetId: string,
  snap: ProjectOsSnapshot,
): { label: string; value: string; hint: string } {
  const closing = snap.isComplete && snap.pendingPayments > 0;
  const complete = snap.isComplete && snap.pendingPayments === 0;

  switch (widgetId) {
    case 'kpi_budget':
      if (closing) {
        return {
          label: 'Оплаты',
          value: paymentWord(snap.pendingPayments),
          hint: 'к оплате',
        };
      }
      return {
        label: 'Бюджет',
        value: snap.budget.planned > 0 ? `${Math.round((snap.budget.spent / snap.budget.planned) * 100)}%` : '—',
        hint: budgetRemainingHint(snap.budget.spent, snap.budget.planned),
      };
    case 'kpi_schedule':
      if (closing) {
        return { label: 'Сроки', value: '100%', hint: 'работы завершены' };
      }
      if (complete) {
        return { label: 'Сроки', value: '100%', hint: 'проект завершён' };
      }
      return {
        label: 'Сроки',
        value: `${snap.schedule.progressPercent}%`,
        hint: snap.schedule.overdueCount
          ? `просрочка ${snap.schedule.overdueCount}`
          : snap.schedule.currentStage || '—',
      };
    case 'kpi_materials':
      return { label: 'Материалы', value: String(snap.materials.needBuy), hint: 'к закупке' };
    case 'kpi_quality':
      return { label: 'Качество', value: String(snap.quality.awaitingAcceptance), hint: 'приёмка' };
    default:
      return { label: '—', value: '—', hint: '' };
  }
}
