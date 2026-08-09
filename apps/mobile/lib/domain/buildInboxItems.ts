/** Сборка элементов единого inbox — главная, /inbox, badge в шапке */
import { api, type ApprovalItem, type ProjectDetail, type Stage } from '@/lib/api';
import { formatRub } from '@/constants/Theme';
import { budgetTabHref, calendarTabHref, objectTabHref, repairTabHref, type OsRole } from '@/constants/osSections';
import { reportError } from '@/lib/reportError';
import { buildCloseoutInboxItem } from './closeoutHome';
import { navigationTargetHref, warrantyRoute } from '@/lib/navigation/navigationPolicy';

export type InboxItem =
  | { id: string; title: string; sub?: string; href: string; kind: string; priority: number }
  | { id: string; title: string; sub?: string; kind: 'approval'; approval: ApprovalItem; priority: number };

export type InboxSource =
  | 'chat'
  | 'payments'
  | 'approval_hub'
  | 'acceptances'
  | 'work_schedule'
  | 'contract_gate'
  | 'issues'
  | 'material_picks'
  | 'selections'
  | 'change_orders'
  | 'warranty'
  | 'documents'
  | 'work_orders'
  | 'closeout'
  | 'floor_plans'
  | 'offline_outbox';

export type InboxBuildIssue = {
  projectId: string;
  source: InboxSource;
};

export type InboxBuildResult = {
  items: InboxItem[];
  health: 'complete' | 'degraded';
  issues: InboxBuildIssue[];
};

type BuildInboxOptions = {
  userId: string;
  projectId: string;
  role: OsRole;
  chatUnread: number;
  project?: ProjectDetail | null;
};

async function loadInboxSource<T>(
  source: InboxSource,
  opts: Pick<BuildInboxOptions, 'projectId' | 'role'>,
  issues: InboxBuildIssue[],
  load: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await load();
  } catch (error) {
    issues.push({ projectId: opts.projectId, source });
    reportError(`inbox.build.${source}`, error, { projectId: opts.projectId, role: opts.role });
    return undefined;
  }
}

function overdueStages(stages: Stage[]) {
  const today = new Date().toISOString().slice(0, 10);
  return stages.filter((s) => s.planned_end && s.planned_end < today && s.status !== 'done');
}

function reworkStages(stages: Stage[]) {
  return stages.filter((s) => s.needs_rework);
}

export async function buildInboxItemsWithHealth(opts: BuildInboxOptions): Promise<InboxBuildResult> {
  const { userId, projectId, role, chatUnread, project } = opts;
  const isCustomer = role === 'customer';
  const stages = project?.stages || [];
  const next: InboxItem[] = [];
  const issues: InboxBuildIssue[] = [];
  let pendingAcceptance = 0;

  if (chatUnread > 0) {
    next.push({
      id: 'chat',
      kind: 'chat',
      title: 'Непрочитанные сообщения',
      sub: `${chatUnread} непрочитанных`,
      href: role === 'contractor' ? '/(contractor)/(tabs)/chat' : '/(customer)/(tabs)/chat',
      priority: 90,
    });
  }

  if (isCustomer) {
    const payments = await loadInboxSource('payments', opts, issues, () => api.listPayments(userId, projectId));
    for (const payment of payments?.filter((item) => item.status === 'pending') ?? []) {
      next.push({
        id: `pay-${payment.id}`,
        kind: 'payment',
        title: payment.title || 'Счёт к оплате',
        sub: formatRub(payment.amount),
        href: budgetTabHref(role, 'payments'),
        priority: 85,
      });
    }

    const hub = await loadInboxSource('approval_hub', opts, issues, () => api.approvalHub(userId, projectId));
    hub?.items.forEach((item) => {
      next.push({
        id: `ap-${item.type}-${item.id}`,
        kind: 'approval',
        title: item.title,
        sub: item.subtitle || 'Согласование',
        approval: item,
        priority: 80,
      });
    });

    const acceptance = await loadInboxSource('acceptances', opts, issues, () => api.acceptancesPendingCount(userId, projectId));
    pendingAcceptance = acceptance?.count ?? 0;
    if (pendingAcceptance > 0) {
      const reviewStage = stages.find((stage) => stage.status === 'review');
      next.push({
        id: 'acceptance',
        kind: 'acceptance',
        title: 'Приёмка этапов',
        sub: reviewStage ? `${pendingAcceptance} · ${reviewStage.name}` : `${pendingAcceptance} ожидает`,
        href: reviewStage ? `/stage/${reviewStage.id}` : repairTabHref(role, 'control'),
        priority: 88,
      });
    }

    const schedule = await loadInboxSource('work_schedule', opts, issues, () => api.getActiveWorkSchedule(userId, projectId));
    if (schedule?.status === 'submitted') {
      next.push({
        id: 'schedule-confirm',
        kind: 'schedule',
        title: 'Подтвердить график работ',
        sub: schedule.title || 'План на согласовании',
        href: calendarTabHref(role),
        priority: 86,
      });
    }

    if (
      project
      && (project.estimate_lines?.length ?? 0) > 0
      && !project.estimate_locked_at
      && (project.estimate_lock_proposed_at || !project.contractor_id)
    ) {
      next.push({
        id: 'estimate-lock',
        kind: 'estimate',
        title: 'Зафиксировать смету',
        sub: project.estimate_lock_proposed_at
          ? `${project.estimate_lines!.length} поз. · на согласовании`
          : `${project.estimate_lines!.length} поз.`,
        href: objectTabHref(role, 'estimate'),
        priority: 82,
      });
    } else if (
      project
      && (project.estimate_lines?.length ?? 0) > 0
      && !project.estimate_locked_at
      && !project.estimate_lock_proposed_at
      && project.contractor_id
    ) {
      next.push({
        id: 'estimate-wait',
        kind: 'estimate',
        title: 'Смета у исполнителя',
        sub: 'Ждём отправку на согласование',
        href: objectTabHref(role, 'estimate'),
        priority: 50,
      });
    }

    if (project?.estimate_locked_at) {
      const gate = await loadInboxSource('contract_gate', opts, issues, () => api.getContractGate(userId, projectId));
      if (gate?.ok === false) {
        const titles = (gate.pending_titles || []).slice(0, 2).join(', ');
        next.push({
          id: 'contract-sign',
          kind: 'document',
          title: 'Подписать договор',
          sub: titles || gate.message || 'Документы ждут подписи',
          href: '/documents',
          priority: 81,
        });
      }
    }

    const fixedIssues = await loadInboxSource('issues', opts, issues, () => api.listIssues(userId, projectId, 'fixed'));
    if (fixedIssues?.length) {
      const first = fixedIssues[0];
      next.push({
        id: 'issues-fixed',
        kind: 'quality',
        title: 'Подтвердить исправления',
        sub: `${fixedIssues.length} · ${first?.title || ''}`,
        href: first?.stage_id ? `/stage/${first.stage_id}` : '/control',
        priority: 79,
      });
    }

    const materialPicks = await loadInboxSource('material_picks', opts, issues, () => api.listMaterialPicks(userId, projectId));
    const pendingMaterials = materialPicks?.filter((item) => item.status === 'pending') ?? [];
    const hasMaterialApproval = next.some(
      (item) => item.kind === 'approval' && 'approval' in item && item.approval.type === 'material',
    );
    if (pendingMaterials.length > 0 && !hasMaterialApproval) {
      next.push({
        id: 'materials-pending',
        kind: 'material',
        title: 'Материалы на согласование',
        sub: `${pendingMaterials.length} · ${pendingMaterials[0]?.name || ''}`,
        href: pendingMaterials.length === 1 && pendingMaterials[0]
          ? `/material/${pendingMaterials[0].id}`
          : repairTabHref(role, 'materials'),
        priority: 77,
      });
    }

    const selections = await loadInboxSource('selections', opts, issues, () => api.selectionsPendingCount(userId, projectId));
    if ((selections?.count ?? 0) > 0) {
      next.push({
        id: 'selections-pending',
        kind: 'selection',
        title: 'Подбор на согласование',
        sub: `${selections!.count} поз.`,
        href: repairTabHref(role, 'selections'),
        priority: 76,
      });
    }

    const hasChangeOrderApproval = next.some(
      (item) => item.kind === 'approval' && 'approval' in item && item.approval.type === 'change_order',
    );
    if (!hasChangeOrderApproval) {
      const changeOrders = await loadInboxSource('change_orders', opts, issues, () => api.listChangeOrders(userId, projectId));
      const pendingChangeOrders = changeOrders?.filter((item) => item.status === 'pending') ?? [];
      if (pendingChangeOrders.length > 0) {
        next.push({
          id: 'change-orders',
          kind: 'change_order',
          title: pendingChangeOrders.length === 1 ? 'Согласовать доп. работы' : `Согласовать ${pendingChangeOrders.length} ДО`,
          sub: pendingChangeOrders[0]?.title || 'Изменение сметы',
          href: `${objectTabHref(role, 'estimate')}&estimateLayer=changes`,
          priority: 83,
        });
      }
    }

    const warranty = await loadInboxSource('warranty', opts, issues, () => api.listWarrantyClaims(userId, projectId));
    if ((warranty?.open ?? 0) > 0) {
      next.push({
        id: 'warranty-open',
        kind: 'warranty',
        title: (warranty?.overdue ?? 0) > 0 ? `Гарантия: ${warranty!.overdue} просрочено` : 'Открытые гарантии',
        sub: `${warranty!.open} обращений`,
        href: navigationTargetHref(warrantyRoute(role, { projectId, source: 'inbox' })),
        priority: 78,
      });
    }

    if (!next.some((item) => item.id === 'contract-sign')) {
      const documents = await loadInboxSource('documents', opts, issues, () => api.listProjectDocuments(userId, projectId));
      const drafts = (documents?.items || []).filter((item) => item.status === 'draft');
      if (drafts.length > 0) {
        next.push({
          id: 'docs-sign',
          kind: 'document',
          title: drafts.length === 1 ? 'Подписать документ' : `Подписать ${drafts.length} док.`,
          sub: drafts[0]?.title || 'Черновики в Документах',
          href: '/documents',
          priority: 76,
        });
      }
    }
  } else {
    const payments = await loadInboxSource('payments', opts, issues, () => api.listPayments(userId, projectId));
    for (const payment of payments?.filter((item) => item.status === 'pending') ?? []) {
      next.push({
        id: `pay-wait-${payment.id}`,
        kind: 'payment',
        title: 'Ждём оплату заказчика',
        sub: `${payment.title || 'Счёт'} · ${formatRub(payment.amount)}`,
        href: budgetTabHref(role, 'payments'),
        priority: 84,
      });
    }

    const rework = reworkStages(stages);
    if (rework.length > 0) {
      next.push({
        id: 'rework',
        kind: 'stage',
        title: 'Доработка этапов',
        sub: `${rework.length} · ${rework[0]?.name || ''}`,
        href: rework.length === 1 && rework[0] ? `/stage/${rework[0].id}` : repairTabHref(role, 'works', 'rework'),
        priority: 87,
      });
    }

    const acceptance = await loadInboxSource('acceptances', opts, issues, () => api.acceptancesPendingCount(userId, projectId));
    const review = stages.filter((stage) => stage.status === 'review');
    const awaitAcceptance = Math.max(acceptance?.count ?? 0, review.length);
    if (awaitAcceptance > 0) {
      next.push({
        id: 'await-acceptance',
        kind: 'acceptance',
        title: 'Ждём приёмку заказчика',
        sub: review[0]?.name ? `${awaitAcceptance} · ${review[0].name}` : `${awaitAcceptance} в очереди`,
        href: review[0] ? `/stage/${review[0].id}` : repairTabHref(role, 'control'),
        priority: 88,
      });
    }

    const changeOrders = await loadInboxSource('change_orders', opts, issues, () => api.listChangeOrders(userId, projectId));
    const pendingChangeOrders = changeOrders?.filter((item) => item.status === 'pending') ?? [];
    if (pendingChangeOrders.length > 0) {
      next.push({
        id: 'change-orders-wait',
        kind: 'change_order',
        title: 'Доп. работы у заказчика',
        sub: pendingChangeOrders.length === 1
          ? pendingChangeOrders[0]?.title || 'Ждём согласование'
          : `${pendingChangeOrders.length} на согласовании`,
        href: `${objectTabHref(role, 'estimate')}&estimateLayer=changes`,
        priority: 83,
      });
    }

    const schedule = await loadInboxSource('work_schedule', opts, issues, () => api.getActiveWorkSchedule(userId, projectId));
    if (schedule?.status === 'submitted') {
      next.push({
        id: 'schedule-waiting',
        kind: 'schedule',
        title: 'График у заказчика',
        sub: 'Ждём подтверждение',
        href: calendarTabHref(role),
        priority: 86,
      });
    }

    const materialPicks = await loadInboxSource('material_picks', opts, issues, () => api.listMaterialPicks(userId, projectId));
    const draftMaterials = materialPicks?.filter((item) => item.status === 'draft' || item.status === 'pending').length ?? 0;
    if (draftMaterials > 0) {
      next.push({
        id: 'materials',
        kind: 'material',
        title: 'Материалы к заказу',
        sub: `${draftMaterials} поз.`,
        href: repairTabHref(role, 'materials'),
        priority: 75,
      });
    }
  }

  const overdue = overdueStages(stages);
  if (overdue.length > 0) {
    next.push({
      id: 'stages-overdue',
      kind: 'stage',
      title: 'Просроченные этапы',
      sub: `${overdue.length} · ${overdue[0]?.name || ''}`,
      href: overdue.length === 1 && overdue[0] ? `/stage/${overdue[0].id}` : repairTabHref(role, 'works', 'overdue'),
      priority: 92,
    });
  }

  const workOrders = await loadInboxSource('work_orders', opts, issues, () => api.listWorkOrders(userId, projectId));
  if (workOrders) {
    const reviewWorkOrders = workOrders.filter((item) => item.status === 'review');
    const pendingWorkOrders = workOrders.filter((item) => ['published', 'negotiating', 'approved'].includes(item.status));
    if (isCustomer && reviewWorkOrders.length > 0 && pendingAcceptance === 0) {
      next.push({
        id: 'wo-review',
        kind: 'work',
        title: 'Работы на приёмке',
        sub: `${reviewWorkOrders.length} · ${reviewWorkOrders[0]?.title || ''}`,
        href: reviewWorkOrders.length === 1 && reviewWorkOrders[0]
          ? `/work-order/${reviewWorkOrders[0].id}`
          : repairTabHref(role, 'control'),
        priority: 84,
      });
    }
    if (!isCustomer && pendingWorkOrders.length > 0) {
      next.push({
        id: 'wo-pending',
        kind: 'work',
        title: 'Работы ждут действия',
        sub: `${pendingWorkOrders.length} · ${pendingWorkOrders[0]?.title || ''}`,
        href: pendingWorkOrders.length === 1 && pendingWorkOrders[0]
          ? `/work-order/${pendingWorkOrders[0].id}`
          : calendarTabHref(role),
        priority: 83,
      });
    }
  }

  const allDone = stages.length > 0 && stages.every((stage) => stage.status === 'done');
  if (allDone || (project as { is_archived?: boolean } | null)?.is_archived) {
    const closeout = await loadInboxSource('closeout', opts, issues, () => api.closeoutChecklist(userId, projectId));
    if (closeout) {
      const row = buildCloseoutInboxItem({
        ready: closeout.ready,
        archived: closeout.archived,
        next_action: closeout.next_action,
        warranty_open: closeout.warranty_open,
        pending_payments: closeout.pending_payments,
        acceptance_acts_active: closeout.acceptance_acts_active,
        all_stages_done: closeout.all_stages_done ?? allDone,
      });
      if (row) next.push(row);
    }
  }

  if (stages.some((stage) => stage.status !== 'done')) {
    const floorPlans = await loadInboxSource('floor_plans', opts, issues, () => api.listFloorPlans(userId, projectId));
    if ((floorPlans?.length ?? 0) > 0) {
      next.push({
        id: 'floor-punch',
        kind: 'issue',
        title: 'Сфоткать дефект на плане',
        sub: 'Тап на чертёж → фото → QC',
        href: objectTabHref(role, 'plan', 'floor') + '&punch=1',
        priority: 48,
      });
    }
  }

  return {
    items: next.sort((a, b) => b.priority - a.priority),
    health: issues.length > 0 ? 'degraded' : 'complete',
    issues,
  };
}

/** Совместимый API для поверхностей, которым пока нужны только строки. */
export async function buildInboxItems(opts: BuildInboxOptions): Promise<InboxItem[]> {
  return (await buildInboxItemsWithHealth(opts)).items;
}

/** Dedup inbox vs hero «Сделать сейчас» — главная, /inbox, «Все задачи». */
export function filterInboxForHero<T extends { kind: string; id: string; title: string }>(items: T[], heroKind: string): T[] {
  if (!heroKind || heroKind === 'idle') return items;
  return items.filter((it) => {
    if (heroKind === 'payment' && it.kind === 'payment') return false;
    if (heroKind === 'accept' && (it.kind === 'acceptance' || it.id === 'acceptance' || it.id === 'await-acceptance' || it.id === 'wo-review')) return false;
    if (heroKind === 'work' && (it.id === 'wo-review' || it.id === 'schedule-confirm' || it.id === 'schedule-waiting' || (it.kind === 'work' && /приёмк/i.test(it.title)))) return false;
    if (heroKind === 'work' && it.kind === 'stage' && /просроч/i.test(it.title)) return false;
    if (heroKind === 'work' && it.kind === 'offline') return false;
    if (heroKind === 'expense' && (it.kind === 'estimate' || it.id === 'estimate-lock' || it.kind === 'change_order')) return false;
    if (heroKind === 'material' && (it.kind === 'material' || it.kind === 'selection')) return false;
    if (heroKind === 'issue' && it.kind === 'warranty') return false;
    if (heroKind === 'review' && (it.kind === 'document' || it.kind === 'closeout')) return false;
    return true;
  });
}

/** Hero kind по приоритету inbox — совпадает с логикой nextAction на главной. */
export function deriveInboxHeroKind(items: InboxItem[]): string {
  if (items.some((i) => i.kind === 'payment')) return 'payment';
  if (items.some((i) => i.id === 'acceptance')) return 'accept';
  if (items.some((i) => i.kind === 'stage' && /просроч/i.test(i.title))) return 'work';
  if (items.some((i) => i.id === 'materials-pending')) return 'material';
  return 'idle';
}

/** Строки inbox для ссылки «Все задачи» — без дубля hero (оплата уже в CTA) */
export function inboxLinkItems<T extends { kind: string; id: string; title: string }>(
  items: T[],
  heroKind: string,
): T[] {
  return filterInboxForHero(items, heroKind);
}

export function inboxTotal(items: InboxItem[], chatUnread: number): number {
  const rows = items.length;
  if (items.some((i) => i.id === 'chat')) return rows;
  return rows + chatUnread;
}

/** Badge задач «Входящие» — без чата (оплаты, приёмка и т.д.) */
export function inboxTaskBadge(items: InboxItem[]): number {
  return items.filter((i) => i.kind !== 'chat').length;
}

/** Badge «Входящие» — задачи + каждое непрочитанное сообщение */
export function inboxAttentionBadge(items: InboxItem[], chatUnread: number): number {
  return inboxTaskBadge(items) + Math.max(0, chatUnread);
}

/** @deprecated используйте inboxAttentionBadge */
export function inboxMenuBadge(items: InboxItem[]): number {
  return items.length;
}
