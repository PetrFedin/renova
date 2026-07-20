/** Сборка единого снимка состояния проекта Renova OS */
import { buildAttention } from '@/lib/attention';
import type { Dashboard, MaterialPick, OsBudgetSummary, OsRisk, OsScheduleSummary, ProjectDetail, Purchase, ReceiptItem } from '@/lib/api';
import { resolveBudgetFigures } from '@/lib/useOsBudgetFigures';
import { formatRub } from '@/constants/Theme';
import type { ProjectOsSnapshot } from './osTypes';
import { computeProjectHealth, forecastFinalCost, capOverrunRisk } from './projectHealth';
import { sanitizeRiskImpact } from './sanitizeRiskImpact';
import { resolveProjectProgress } from './resolveProjectProgress';
import { repairTabRoute, budgetTabRoute, calendarTabRoute, objectTabRoute } from '@/constants/osSections';

/**
 * Подсказки для nextAction (W55 schedule + W76 очередь приёмки/ДО/подписи/гарантии).
 * status — active work-schedule; остальные счётчики с home load.
 */
export type WorkScheduleHint = {
  status?: string | null;
  /** Открытые гарантийные обращения */
  warrantyOpen?: number;
  /** Просроченные по SLA */
  warrantyOverdue?: number;
  /** Change orders со статусом pending */
  pendingChangeOrders?: number;
  /** Документы status=draft (ждут подписи) */
  pendingSignDocs?: number;
};

/** @deprecated alias — используйте WorkScheduleHint */
export type NextActionHints = WorkScheduleHint;

const ST_SHORT: Record<string, string> = {
  done: 'Завершено', review: 'Ждёт приёмки', active: 'В работе', planned: 'Не начато', rework: 'Доработка',
};

/** Риски без дублей оплаты — inbox уже показывает «Ожидают оплаты» */
export function filterHomeRisks<T extends { kind?: string; title: string; impact: string }>(
  risks: T[],
  planned: number,
): T[] {
  return risks
    .filter((r) => r.kind !== 'payment' && r.kind !== 'budget' && !/оплат/i.test(r.title))
    .map((r) => ({ ...r, impact: sanitizeRiskImpact(r.impact, planned) }));
}

export function buildProjectOsSnapshot(
  project: ProjectDetail,
  dash: Dashboard,
  receipts: ReceiptItem[],
  picks: MaterialPick[],
  purchases: Purchase[] = [],
  apiRisks: OsRisk[] = [],
  osSchedule: OsScheduleSummary | null = null,
  role: 'customer' | 'contractor',
  osBudget: OsBudgetSummary | null = null,
  pendingAcceptanceCount?: number,
  pendingPaymentCount = 0,
  pendingPaymentTotal = 0,
  workSchedule?: WorkScheduleHint | null,
): ProjectOsSnapshot {
  const today = new Date().toISOString().slice(0, 10);
  const stages = project.stages || [];
  const overdue = stages.filter((s) => s.planned_end && s.planned_end < today && s.status !== 'done');
  const review = stages.filter((s) => s.status === 'review');
  const rework = stages.filter((s) => s.status === 'rework');
  const active = stages.filter((s) => s.status === 'active' || s.status === 'review');
  const budgetFigures = resolveBudgetFigures(project, osBudget);
  const spent = budgetFigures.spent;
  const planned = budgetFigures.planned;
  const progressPercent = resolveProjectProgress(stages, dash.progress_percent || 0, osSchedule?.progress_percent);
  const allDone = stages.length > 0 && stages.every((s) => s.status === 'done');
  const isComplete = allDone || progressPercent >= 100;
  const forecast = forecastFinalCost(planned, spent, progressPercent);
  const needBuy = picks.filter((p) => p.status === 'draft' || p.status === 'pending').length;
  const pendingApprove = picks.filter((p) => p.status === 'pending').length;
  const shortage = picks.filter((p) => p.status === 'pending' && !p.qty).length;
  // W55: только реальные Payment.pending — без proxy «done без accept»
  const unpaid = Math.max(0, pendingPaymentCount);

  let health = computeProjectHealth({
    budgetPlanned: planned,
    budgetSpent: spent,
    progressPercent,
    overdueStages: overdue.length,
    reviewStages: review.length,
    reworkStages: rework.length,
    materialsNeedBuy: needBuy,
    materialsShortage: shortage,
    pendingPayments: unpaid,
    budgetAlerts: spent >= planned * 0.9 && planned > 0 ? 1 : 0,
  });
  if (isComplete) {
    const wOpen = Math.max(0, workSchedule?.warrantyOpen ?? 0);
    const wOver = Math.max(0, workSchedule?.warrantyOverdue ?? 0);
    if (unpaid > 0) {
      health = {
        score: 90,
        level: 'attention',
        label: 'Закрытие',
        factors: [`${unpaid} счетов к оплате`],
      };
    } else if (wOpen > 0) {
      health = {
        score: wOver > 0 ? 70 : 85,
        level: wOver > 0 ? 'risk' : 'attention',
        label: 'Гарантия',
        factors: wOver > 0
          ? [`${wOver} гарантий просрочено`, `${wOpen} открыто`]
          : [`${wOpen} открытых гарантий`],
      };
    } else {
      health = {
        score: 100,
        level: 'good',
        label: 'Завершён',
        factors: [],
      };
    }
  }

  const attention = buildAttention(project, role);
  const rawRisks = (apiRisks.length ? apiRisks : attention.slice(0, 3).map((a) => ({
    id: a.id,
    kind: (a.kind === 'deadline' ? 'schedule' : a.kind === 'payment' ? 'payment' : a.kind === 'review' ? 'quality' : 'budget') as any,
    title: a.title,
    impact: a.subtitle,
    action: a.kind === 'review' ? 'Открыть этап' : 'Посмотреть',
    href: a.href,
    severity: 'medium',
    cause: a.subtitle,
  }))).slice(0, 3).map((r) => ({
    id: r.id,
    kind: r.kind as any,
    title: r.title,
    impact: r.impact,
    action: r.action || 'Открыть',
    href: r.href,
  }));
  const risks = filterHomeRisks(rawRisks, planned);

  const reviewStage = review[0];
  const overdueStage = overdue[0];
  const dashTitle = dash.next_action_title || '';
  const dashSaysComplete = /заверш/i.test(dashTitle);
  const scheduleSubmitted = workSchedule?.status === 'submitted';
  const warrantyOpen = Math.max(0, workSchedule?.warrantyOpen ?? 0);
  const warrantyOverdue = Math.max(0, workSchedule?.warrantyOverdue ?? 0);
  const pendingChangeOrders = Math.max(0, workSchedule?.pendingChangeOrders ?? 0);
  const pendingSignDocs = Math.max(0, workSchedule?.pendingSignDocs ?? 0);
  const waPending = Math.max(0, pendingAcceptanceCount ?? 0);
  const estimateLines = project.estimate_lines?.length ?? 0;
  const estimateNeedsLock = estimateLines > 0 && !project.estimate_locked_at;

  const changeOrdersHref = (() => {
    const route = objectTabRoute(role, 'estimate');
    return {
      pathname: route.pathname,
      params: { ...(route.params || {}), estimateLayer: 'changes' },
    };
  })();

  let nextAction: ProjectOsSnapshot['nextAction'];
  if (isComplete) {
    if (unpaid > 0) {
      nextAction = role === 'customer'
        ? {
          title: unpaid === 1 ? 'Оплатить 1 счёт' : `Оплатить ${unpaid} счетов`,
          subtitle: pendingPaymentTotal > 0
            ? `${formatRub(pendingPaymentTotal)} к оплате`
            : `${unpaid} счёт(ов)`,
          button: 'Оплатить',
          href: budgetTabRoute(role, 'payments'),
          kind: 'payment',
        }
        : {
          title: unpaid === 1 ? 'Ждём оплату 1 счёта' : `Ждём оплату ${unpaid} счетов`,
          subtitle: pendingPaymentTotal > 0
            ? `${formatRub(pendingPaymentTotal)} у заказчика`
            : 'Счёт выставлен',
          button: 'Счета',
          href: budgetTabRoute(role, 'payments'),
          kind: 'payment',
        };
    } else if (warrantyOpen > 0) {
      // W76: после сдачи — гарантия важнее «пустого» closeout
      nextAction = {
        title: warrantyOverdue > 0
          ? `Гарантия: ${warrantyOverdue} просрочено`
          : warrantyOpen === 1
            ? 'Открыта гарантия'
            : `Гарантия: ${warrantyOpen} открыто`,
        subtitle: project.is_archived
          ? 'Пост-сдача: закройте обращения или создайте новое'
          : 'Закройте обращения перед архивом объекта',
        button: 'Гарантия',
        href: '/documents',
        kind: 'issue',
      };
    } else if (pendingSignDocs > 0 && role === 'customer') {
      nextAction = {
        title: pendingSignDocs === 1 ? 'Подписать документ' : `Подписать ${pendingSignDocs} док.`,
        subtitle: 'Черновики ждут электронной подписи',
        button: 'Документы',
        href: '/documents',
        kind: 'review',
      };
    } else {
      nextAction = {
        title: 'Закрытие объекта',
        subtitle: 'Проверьте акты, оплаты и гарантию в Документах',
        button: 'Документы',
        href: '/documents',
        kind: 'review',
      };
    }
  } else if (unpaid > 0 && role === 'contractor') {
    nextAction = {
      title: unpaid === 1 ? 'Ждём оплату заказчика' : `Ждём оплату · ${unpaid} сч.`,
      subtitle: pendingPaymentTotal > 0
        ? `${formatRub(pendingPaymentTotal)} выставлено`
        : 'Счёт у заказчика',
      button: 'Счета',
      href: budgetTabRoute(role, 'payments'),
      kind: 'payment',
    };
  } else if (unpaid > 0 && role === 'customer') {
    nextAction = {
      title: unpaid === 1 ? 'Оплатить 1 счёт' : `Оплатить ${unpaid} счетов`,
      subtitle: pendingPaymentTotal > 0
        ? `${formatRub(pendingPaymentTotal)} к оплате`
        : 'Счёт после приёмки',
      button: 'Оплатить',
      href: budgetTabRoute(role, 'payments'),
      kind: 'payment',
    };
  } else if (waPending > 0 && role === 'customer') {
    // W76: WorkAcceptance.requested/in_review — даже если stage ещё не review
    nextAction = {
      title: reviewStage
        ? `Принять этап: ${reviewStage.name}`
        : waPending === 1
          ? 'Принять работы'
          : `Принять · ${waPending} очереди`,
      subtitle: reviewStage ? 'Этап ждёт приёмки' : 'Есть заявки на приёмку',
      button: 'Принять',
      href: repairTabRoute(role, 'control'),
      kind: 'accept',
    };
  } else if (waPending > 0 && role === 'contractor') {
    nextAction = {
      title: reviewStage
        ? `Ждём приёмку: ${reviewStage.name}`
        : waPending === 1
          ? 'Ждём приёмку заказчика'
          : `Ждём приёмку · ${waPending}`,
      subtitle: 'Заказчик проверяет работы',
      button: 'Статус',
      href: repairTabRoute(role, 'control'),
      kind: 'accept',
    };
  } else if (reviewStage && role === 'customer') {
    nextAction = {
      title: `Принять этап: ${reviewStage.name}`,
      subtitle: 'Этап ждёт приёмки',
      button: 'Принять',
      href: repairTabRoute(role, 'control'),
      kind: 'accept',
    };
  } else if (reviewStage && role === 'contractor') {
    nextAction = {
      title: `Ждём приёмку: ${reviewStage.name}`,
      subtitle: 'Заказчик проверяет этап',
      button: 'Статус',
      href: repairTabRoute(role, 'control'),
      kind: 'accept',
    };
  } else if (pendingChangeOrders > 0 && role === 'customer') {
    nextAction = {
      title: pendingChangeOrders === 1 ? 'Согласовать доп. работы' : `Согласовать ${pendingChangeOrders} ДО`,
      subtitle: 'Изменение сметы ждёт решения',
      button: 'Доп. работы',
      href: changeOrdersHref,
      kind: 'expense',
    };
  } else if (pendingChangeOrders > 0 && role === 'contractor') {
    nextAction = {
      title: 'Доп. работы у заказчика',
      subtitle: pendingChangeOrders === 1 ? 'Ждём согласование' : `${pendingChangeOrders} на согласовании`,
      button: 'Открыть',
      href: changeOrdersHref,
      kind: 'expense',
    };
  } else if (pendingSignDocs > 0 && role === 'customer') {
    nextAction = {
      title: pendingSignDocs === 1 ? 'Подписать документ' : `Подписать ${pendingSignDocs} док.`,
      subtitle: 'Черновики в Документах',
      button: 'Документы',
      href: '/documents',
      kind: 'review',
    };
  } else if (scheduleSubmitted && role === 'customer') {
    nextAction = {
      title: 'Подтвердить график работ',
      subtitle: 'Исполнитель отправил план на согласование',
      button: 'График',
      href: calendarTabRoute(role),
      kind: 'work',
    };
  } else if (scheduleSubmitted && role === 'contractor') {
    nextAction = {
      title: 'График у заказчика',
      subtitle: 'Ждём подтверждение плана',
      button: 'Открыть',
      href: calendarTabRoute(role),
      kind: 'work',
    };
  } else if (estimateNeedsLock && role === 'customer') {
    const proposed = !!project.estimate_lock_proposed_at;
    const solo = !project.contractor_id;
    nextAction = {
      title: proposed || solo ? 'Согласовать смету' : 'Смета ещё у исполнителя',
      subtitle: proposed || solo
        ? `${estimateLines} поз. · зафиксировать перед договором`
        : 'Ждём отправку сметы на согласование',
      button: 'Смета',
      href: objectTabRoute(role, 'estimate'),
      kind: 'expense',
    };
  } else if (estimateNeedsLock && role === 'contractor') {
    const proposed = !!project.estimate_lock_proposed_at;
    nextAction = {
      title: proposed ? 'Смета у заказчика' : 'Отправить смету на согласование',
      subtitle: proposed ? 'Ждём фиксацию заказчиком' : 'Предложить фиксацию без одностороннего lock',
      button: 'Смета',
      href: objectTabRoute(role, 'estimate'),
      kind: 'expense',
    };
  } else if (osSchedule && (osSchedule.forecast_delay_days || 0) > 3 && role !== 'contractor') {
    nextAction = { title: 'Риск задержки проекта', subtitle: `Прогноз +${osSchedule.forecast_delay_days} дн.`, button: 'График', href: repairTabRoute(role, 'works'), kind: 'work' };
  } else if (overdueStage) {
    nextAction = { title: `Просрочка: ${overdueStage.name}`, subtitle: `Дедлайн ${overdueStage.planned_end}`, button: 'Открыть', href: `/stage/${overdueStage.id}`, kind: 'work' };
  } else if (role === 'customer' && pendingApprove > 0) {
    nextAction = {
      title: 'Согласовать материалы',
      subtitle: `${pendingApprove} поз. ждут решения`,
      button: 'Материалы',
      href: repairTabRoute(role, 'materials'),
      kind: 'material',
    };
  } else if (role === 'contractor' && needBuy > 0) {
    nextAction = {
      title: 'Закупить материалы',
      subtitle: `${needBuy} поз. ждут заказа`,
      button: 'Материалы',
      href: repairTabRoute(role, 'materials'),
      kind: 'material',
    };
  } else if (dashTitle && !dashSaysComplete) {
    const deadline = osSchedule?.planned_end || project.planned_end_date;
    nextAction = {
      title: dashTitle,
      subtitle: dash.next_action_type === 'payment' && pendingPaymentTotal > 0
        ? `${formatRub(pendingPaymentTotal)} к оплате`
        : deadline
          ? `до ${deadline}`
          : 'Рекомендация по проекту',
      button: dash.next_action_type === 'payment' ? 'Оплатить' : 'Открыть',
      href: dash.next_action_type === 'payment' ? budgetTabRoute(role, 'payments') : repairTabRoute(role, 'works'),
      kind: dash.next_action_type === 'payment' ? 'payment' : 'work',
    };
  } else {
    const deadline = osSchedule?.planned_end || project.planned_end_date;
    nextAction = {
      title: 'Проверьте текущие работы',
      subtitle: deadline ? `план до ${deadline}` : 'Обновите статус или добавьте расход',
      button: 'Открыть работы',
      href: repairTabRoute(role, 'works'),
      kind: 'work',
    };
  }

  const roomName = (id?: string | null) => project.rooms?.find((r) => r.id === id)?.name;
  const overrunRaw = Math.max(0, forecast - planned);

  return {
    isComplete,
    pendingPayments: unpaid,
    pendingPaymentTotal,
    healthScore: health.score,
    healthLevel: health.level,
    healthLabel: health.label,
    healthFactors: health.factors,
    budget: {
      planned,
      spent,
      remaining: Math.max(0, planned - spent),
      forecast,
      overrunRisk: capOverrunRisk(overrunRaw, planned),
      variancePercent: budgetFigures.variancePercent ?? dash.budget_variance_percent ?? undefined,
    },
    schedule: {
      currentStage: isComplete ? 'Завершён' : (osSchedule?.current_stage || active[0]?.name),
      plannedEnd: osSchedule?.planned_end || project.planned_end_date || stages.find((s) => s.status !== 'done')?.planned_end || undefined,
      forecastEnd: osSchedule?.forecast_end,
      forecastDelayDays: osSchedule?.forecast_delay_days ?? 0,
      progressPercent,
      delayDays: osSchedule?.max_delay_days ?? overdue.length,
      riskLevel: osSchedule?.risk_level,
      overdueCount: osSchedule?.overdue_count ?? overdue.length,
      daysOverdue: dash.days_overdue ?? osSchedule?.max_delay_days ?? undefined,
    },
    materials: {
      needBuy,
      // W66 #18: «Заказано» ≠ «Согласовано» — только закупки в работе
      ordered: purchases.filter((p) => ['ordered', 'paid', 'partial', 'approved'].includes(p.status)).length,
      delivered: Math.max(picks.filter((p) => p.status === 'purchased').length, purchases.filter((p) => p.status === 'delivered').length),
      shortage,
    },
    quality: {
      awaitingAcceptance: pendingAcceptanceCount ?? review.length,
      openIssues: rework.length + attention.filter((a) => a.kind === 'review').length,
      criticalIssues: overdue.length,
    },
    nextAction,
    risks,
    activeWorks: active.slice(0, 3).map((s) => ({
      id: s.id,
      name: s.name,
      room: s.room_ids?.[0] ? roomName(s.room_ids[0]) : undefined,
      status: ST_SHORT[s.status] || s.status,
      end: s.planned_end || undefined,
      href: `/stage/${s.id}`,
    })),
    materialNeeds: picks.filter((p) => p.status !== 'purchased').slice(0, 3).map((p) => ({
      id: p.id,
      name: p.name,
      room: roomName(p.room_id),
      status: p.status === 'pending' ? 'Согласование' : p.status === 'draft' ? 'Купить' : p.status,
      href: { pathname: '/material/[id]', params: { id: p.id } },
    })),
  };
}
