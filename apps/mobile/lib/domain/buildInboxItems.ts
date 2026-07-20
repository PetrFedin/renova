/** Сборка элементов единого inbox — главная, /inbox, badge в шапке */
import { api, type ApprovalItem, type ProjectDetail, type Stage } from '@/lib/api';
import { formatRub } from '@/constants/Theme';
import { budgetTabHref, calendarTabHref, objectTabHref, repairTabHref, type OsRole } from '@/constants/osSections';
import { buildCloseoutInboxItem } from './closeoutHome';

export type InboxItem =
  | { id: string; title: string; sub?: string; href: string; kind: string; priority: number }
  | { id: string; title: string; sub?: string; kind: 'approval'; approval: ApprovalItem; priority: number };

function overdueStages(stages: Stage[]) {
  const today = new Date().toISOString().slice(0, 10);
  return stages.filter((s) => s.planned_end && s.planned_end < today && s.status !== 'done');
}

function reworkStages(stages: Stage[]) {
  return stages.filter((s) => s.needs_rework);
}

export async function buildInboxItems(opts: {
  userId: string;
  projectId: string;
  role: OsRole;
  chatUnread: number;
  project?: ProjectDetail | null;
}): Promise<InboxItem[]> {
  const { userId, projectId, role, chatUnread, project } = opts;
  const isCustomer = role === 'customer';
  const stages = project?.stages || [];
  const next: InboxItem[] = [];
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
    try {
      const payments = await api.listPayments(userId, projectId);
      const pending = payments.filter((p) => p.status === 'pending');
      for (const p of pending) {
        next.push({
          id: `pay-${p.id}`,
          kind: 'payment',
          title: p.title || 'Счёт к оплате',
          sub: formatRub(p.amount),
          href: budgetTabHref(role, 'payments'),
          priority: 85,
        });
      }
    } catch { /* noop */ }

    try {
      const hub = await api.approvalHub(userId, projectId);
      hub.items.forEach((it) => {
        next.push({
          id: `ap-${it.type}-${it.id}`,
          kind: 'approval',
          title: it.title,
          sub: it.subtitle || 'Согласование',
          approval: it,
          priority: 80,
        });
      });
    } catch { /* noop */ }

    try {
      const acc = await api.acceptancesPendingCount(userId, projectId);
      pendingAcceptance = acc.count;
    } catch { /* noop */ }

    if (pendingAcceptance > 0) {
      // W108: как nextAction accept — сразу /stage/{id}, иначе hub control
      const reviewStage = stages.find((s) => s.status === 'review');
      next.push({
        id: 'acceptance',
        kind: 'acceptance',
        title: 'Приёмка этапов',
        sub: reviewStage
          ? `${pendingAcceptance} · ${reviewStage.name}`
          : `${pendingAcceptance} ожидает`,
        href: reviewStage ? `/stage/${reviewStage.id}` : repairTabHref(role, 'control'),
        priority: 88,
      });
    }

    // W55: график submitted + незафиксированная смета — в inbox заказчика
    try {
      const sched = await api.getActiveWorkSchedule(userId, projectId);
      if (sched?.status === 'submitted') {
        next.push({
          id: 'schedule-confirm',
          kind: 'schedule',
          title: 'Подтвердить график работ',
          sub: sched.title || 'План на согласовании',
          href: calendarTabHref(role),
          priority: 86,
        });
      }
    } catch { /* noop */ }

    // W102: «Согласовать смету» только когда исполнитель отправил proposal (или solo без contractor).
    if (
      project
      && (project.estimate_lines?.length ?? 0) > 0
      && !project.estimate_locked_at
      && (project.estimate_lock_proposed_at || !project.contractor_id)
      && role === 'customer'
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
      && role === 'customer'
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

    // W66 #15: после фиксации сметы — подписать договор, если gate не ok
    if (project?.estimate_locked_at) {
      try {
        const gate = await api.getContractGate(userId, projectId);
        if (gate && gate.ok === false) {
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
      } catch { /* noop */ }
    }

    // W66 #22: исправленные замечания ждут подтверждения заказчика
    try {
      const fixed = await api.listIssues(userId, projectId, 'fixed');
      if (fixed.length > 0) {
        next.push({
          id: 'issues-fixed',
          kind: 'quality',
          title: 'Подтвердить исправления',
          sub: `${fixed.length} · ${fixed[0]?.title || ''}`,
          href: repairTabHref(role, 'control'),
          priority: 79,
        });
      }
    } catch { /* noop */ }

    try {
      const picks = await api.listMaterialPicks(userId, projectId);
      const pendingMat = picks.filter((p) => p.status === 'pending');
      const hasMaterialApproval = next.some((it) => it.kind === 'approval' && it.approval.type === 'material');
      if (pendingMat.length > 0 && !hasMaterialApproval) {
        next.push({
          id: 'materials-pending',
          kind: 'material',
          title: 'Материалы на согласование',
          sub: `${pendingMat.length} · ${pendingMat[0]?.name || ''}`,
          href: repairTabHref(role, 'materials'),
          priority: 77,
        });
      }
    } catch { /* noop */ }

    // W109: подбор чистовых — та же поверхность repair?tab=selections
    try {
      const sel = await api.selectionsPendingCount(userId, projectId);
      if ((sel.count ?? 0) > 0) {
        next.push({
          id: 'selections-pending',
          kind: 'selection',
          title: 'Подбор на согласование',
          sub: `${sel.count} поз.`,
          href: repairTabHref(role, 'selections'),
          priority: 76,
        });
      }
    } catch { /* noop */ }

    // W77: ДО / гарантия / draft docs — те же очереди, что nextAction (W76)
    const hasCoApproval = next.some((it) => it.kind === 'approval' && it.approval.type === 'change_order');
    if (!hasCoApproval) {
      try {
        const orders = await api.listChangeOrders(userId, projectId);
        const pendingCo = orders.filter((o) => o.status === 'pending');
        if (pendingCo.length > 0) {
          next.push({
            id: 'change-orders',
            kind: 'change_order',
            title: pendingCo.length === 1 ? 'Согласовать доп. работы' : `Согласовать ${pendingCo.length} ДО`,
            sub: pendingCo[0]?.title || 'Изменение сметы',
            href: `${objectTabHref(role, 'estimate')}&estimateLayer=changes`,
            priority: 83,
          });
        }
      } catch { /* noop */ }
    }

    try {
      const w = await api.listWarrantyClaims(userId, projectId);
      if ((w.open ?? 0) > 0) {
        next.push({
          id: 'warranty-open',
          kind: 'warranty',
          title: (w.overdue ?? 0) > 0 ? `Гарантия: ${w.overdue} просрочено` : 'Открытые гарантии',
          sub: `${w.open} обращений`,
          href: '/documents',
          priority: 78,
        });
      }
    } catch { /* noop */ }

    if (!next.some((it) => it.id === 'contract-sign')) {
      try {
        const docs = await api.listProjectDocuments(userId, projectId);
        const drafts = (docs.items || []).filter((d) => d.status === 'draft');
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
      } catch { /* noop */ }
    }
  } else {
    // W65 #11: исполнитель видит pending invoices (контроль, не оплата)
    try {
      const payments = await api.listPayments(userId, projectId);
      const pending = payments.filter((p) => p.status === 'pending');
      for (const p of pending) {
        next.push({
          id: `pay-wait-${p.id}`,
          kind: 'payment',
          title: 'Ждём оплату заказчика',
          sub: `${p.title || 'Счёт'} · ${formatRub(p.amount)}`,
          href: budgetTabHref(role, 'payments'),
          priority: 84,
        });
      }
    } catch { /* noop */ }

    const rework = reworkStages(stages);
    if (rework.length > 0) {
      next.push({
        id: 'rework',
        kind: 'stage',
        title: 'Доработка этапов',
        sub: `${rework.length} · ${rework[0]?.name || ''}`,
        // W108: один этап → карточка; несколько → фильтр works
        href: rework.length === 1 && rework[0]
          ? `/stage/${rework[0].id}`
          : repairTabHref(role, 'works', 'rework'),
        priority: 87,
      });
    }

    // W77: очередь WA (requested/in_review), не только stage.status=review
    let contractorPendingAcc = 0;
    try {
      const acc = await api.acceptancesPendingCount(userId, projectId);
      contractorPendingAcc = acc.count;
    } catch { /* noop */ }
    const review = stages.filter((s) => s.status === 'review');
    const awaitAcc = Math.max(contractorPendingAcc, review.length);
    if (awaitAcc > 0) {
      next.push({
        id: 'await-acceptance',
        kind: 'acceptance',
        title: 'Ждём приёмку заказчика',
        sub: review[0]?.name
          ? `${awaitAcc} · ${review[0].name}`
          : `${awaitAcc} в очереди`,
        // W108: статус этапа, не общий hub
        href: review[0] ? `/stage/${review[0].id}` : repairTabHref(role, 'control'),
        priority: 88,
      });
    }

    try {
      const orders = await api.listChangeOrders(userId, projectId);
      const pendingCo = orders.filter((o) => o.status === 'pending');
      if (pendingCo.length > 0) {
        next.push({
          id: 'change-orders-wait',
          kind: 'change_order',
          title: 'Доп. работы у заказчика',
          sub: pendingCo.length === 1 ? pendingCo[0]?.title || 'Ждём согласование' : `${pendingCo.length} на согласовании`,
          href: `${objectTabHref(role, 'estimate')}&estimateLayer=changes`,
          priority: 83,
        });
      }
    } catch { /* noop */ }

    try {
      const sched = await api.getActiveWorkSchedule(userId, projectId);
      if (sched?.status === 'submitted') {
        next.push({
          id: 'schedule-waiting',
          kind: 'schedule',
          title: 'График у заказчика',
          sub: 'Ждём подтверждение',
          href: calendarTabHref(role),
          priority: 86,
        });
      }
    } catch { /* noop */ }

    try {
      const picks = await api.listMaterialPicks(userId, projectId);
      const draft = picks.filter((p) => p.status === 'draft' || p.status === 'pending').length;
      if (draft > 0) {
        next.push({
          id: 'materials',
          kind: 'material',
          title: 'Материалы к заказу',
          sub: `${draft} поз.`,
          href: repairTabHref(role, 'materials'),
          priority: 75,
        });
      }
    } catch { /* noop */ }
  }

  const overdue = overdueStages(stages);
  if (overdue.length > 0) {
    next.push({
      id: 'stages-overdue',
      kind: 'stage',
      title: 'Просроченные этапы',
      sub: `${overdue.length} · ${overdue[0]?.name || ''}`,
      href: overdue.length === 1 && overdue[0]
        ? `/stage/${overdue[0].id}`
        : repairTabHref(role, 'works', 'overdue'),
      priority: 92,
    });
  }

  try {
    const workOrders = await api.listWorkOrders(userId, projectId);
    const reviewWo = workOrders.filter((w) => w.status === 'review');
    const pendingWo = workOrders.filter((w) => ['published', 'negotiating', 'approved'].includes(w.status));
    if (isCustomer && reviewWo.length > 0 && pendingAcceptance === 0) {
      next.push({
        id: 'wo-review',
        kind: 'work',
        title: 'Работы на приёмке',
        sub: `${reviewWo.length} · ${reviewWo[0]?.title || ''}`,
        href: repairTabHref(role, 'control'),
        priority: 84,
      });
    }
    if (!isCustomer && pendingWo.length > 0) {
      next.push({
        id: 'wo-pending',
        kind: 'work',
        title: 'Работы ждут действия',
        sub: `${pendingWo.length} · ${pendingWo[0]?.title || ''}`,
        href: calendarTabHref(role),
        priority: 83,
      });
    }
  } catch { /* noop */ }

  // W79: closeout checklist — та же готовность, что DocumentsHub
  try {
    const allDone = stages.length > 0 && stages.every((s) => s.status === 'done');
    if (allDone || (project as { is_archived?: boolean } | null)?.is_archived) {
      const cl = await api.closeoutChecklist(userId, projectId);
      const row = buildCloseoutInboxItem({
        ready: cl.ready,
        archived: cl.archived,
        next_action: cl.next_action,
        warranty_open: cl.warranty_open,
        pending_payments: cl.pending_payments,
        acceptance_acts_active: cl.acceptance_acts_active,
        all_stages_done: cl.all_stages_done ?? allDone,
      });
      if (row) next.push(row);
    }
  } catch { /* noop */ }

  return next.sort((a, b) => b.priority - a.priority);
}

/** Dedup inbox vs hero «Сделать сейчас» — главная, /inbox, «Все задачи». */
export function filterInboxForHero(items: InboxItem[], heroKind: string): InboxItem[] {
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
  return filterInboxForHero(items as InboxItem[], heroKind) as T[];
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
