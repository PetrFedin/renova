/**
 * Заявки биржи: подписи, доступные действия по роли и статусу, постраничная лента.
 * Чистые функции — проверяются без рендера RN (jobLeadUi.test.ts).
 */

export const RENOVATION_TYPE_OPTIONS = [
  { id: 'cosmetic', label: 'Косметический' },
  { id: 'capital', label: 'Капитальный' },
  { id: 'bathroom', label: 'Ванная' },
  { id: 'kitchen', label: 'Кухня' },
  { id: 'house', label: 'Дом / коттедж' },
] as const;

/** Подпись типа ремонта; незнакомое значение не показываем сырым кодом. */
export function renovationTypeLabel(type: string | null | undefined): string {
  const hit = RENOVATION_TYPE_OPTIONS.find((o) => o.id === type);
  if (hit) return hit.label;
  return type ? 'Другой тип ремонта' : 'Тип не указан';
}

const STATUS_LABEL: Record<string, string> = {
  open: 'Принимает КП',
  quoted: 'Исполнитель выбран',
  taken: 'Передана в проект',
  closed: 'Закрыта',
};

/** Статус заявки по-русски (MKT-040): сырая строка `open` пользователю не нужна. */
export function jobLeadStatusLabel(status: string | null | undefined): string {
  if (!status) return 'Статус неизвестен';
  return STATUS_LABEL[status] ?? 'Статус неизвестен';
}

export type JobLeadRole = 'customer' | 'contractor';

export type JobLeadLike = {
  status: string;
  assigned_contractor_id?: string | null;
  quotes?: { contractor_id: string }[];
};

export type JobLeadActions = {
  /** Исполнитель: отозвать свой отклик (заявка ещё открыта). */
  canWithdrawQuote: boolean;
  /** Исполнитель: отправить/обновить КП. */
  canQuote: boolean;
  /** Назначенный исполнитель: отказаться. */
  canDecline: boolean;
  /** Заказчик: закрыть свою открытую заявку. */
  canClose: boolean;
  /** Заказчик: править свою открытую заявку. */
  canEdit: boolean;
  /** Заказчик: выбрать КП / авто-назначение. */
  canPickQuote: boolean;
  /** Исполнитель: КП отправлено, ждём выбора заказчика. */
  awaitingPick: boolean;
};

export function hasOwnQuote(lead: JobLeadLike, userId: string): boolean {
  return (lead.quotes ?? []).some((q) => q.contractor_id === userId);
}

export function jobLeadActions(role: string, userId: string, lead: JobLeadLike): JobLeadActions {
  const isOpen = lead.status === 'open';
  const customer = role === 'customer';
  const contractor = role === 'contractor';
  const mine = contractor && hasOwnQuote(lead, userId);
  return {
    canWithdrawQuote: mine && isOpen,
    canQuote: contractor && isOpen,
    canDecline: contractor && lead.status === 'quoted' && lead.assigned_contractor_id === userId,
    canClose: customer && isOpen,
    canEdit: customer && isOpen,
    canPickQuote: customer && isOpen,
    awaitingPick: mine && isOpen,
  };
}

/** Подсказка исполнителю под заявкой. */
export function contractorLeadNote(lead: JobLeadLike, userId: string): string | null {
  if (lead.status === 'open' && hasOwnQuote(lead, userId)) return 'Ваше КП отправлено — ждём выбора заказчика.';
  if (lead.status === 'quoted' && lead.assigned_contractor_id === userId) return 'Заказчик выбрал вас. Оформите проект или откажитесь.';
  return null;
}

// ── лента открытых заявок: фильтры и «Показать ещё» ───────────────────────

export const LEADS_PAGE_SIZE = 20;

export type LeadFeedFilters = { city: string; renovationType: string | null };

export type LeadFeedQuery = {
  limit: number;
  offset: number;
  city?: string;
  renovation_type?: string;
};

export function buildLeadFeedQuery(filters: LeadFeedFilters, offset: number, limit = LEADS_PAGE_SIZE): LeadFeedQuery {
  const q: LeadFeedQuery = { limit, offset };
  const city = filters.city.trim();
  if (city) q.city = city;
  if (filters.renovationType) q.renovation_type = filters.renovationType;
  return q;
}

export function hasActiveLeadFilters(f: LeadFeedFilters): boolean {
  return f.city.trim().length > 0 || !!f.renovationType;
}

/** Склейка страниц без дублей (старый backend мог вернуть те же строки). */
export function mergeLeadPages<T extends { id: string }>(prev: T[], next: T[]): { items: T[]; added: number } {
  const seen = new Set(prev.map((x) => x.id));
  const fresh = next.filter((x) => !seen.has(x.id));
  return { items: [...prev, ...fresh], added: fresh.length };
}

/** Есть ли смысл просить следующую страницу. */
export function hasMorePages(pageLength: number, added: number, limit = LEADS_PAGE_SIZE): boolean {
  return pageLength >= limit && added > 0;
}

// ── строки запроса к API ──────────────────────────────────────────────────

export function buildJobLeadsQueryString(status: string | undefined, q?: Partial<LeadFeedQuery> & { budget_min?: number; budget_max?: number }): string {
  const p = new URLSearchParams();
  if (status) p.set('status', status);
  if (q) {
    for (const [k, v] of Object.entries(q)) {
      if (v === undefined || v === null || v === '') continue;
      p.set(k, String(v));
    }
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}
