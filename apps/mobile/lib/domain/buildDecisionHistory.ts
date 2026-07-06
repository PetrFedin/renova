/** Пользовательская «история решений» поверх activity feed */
import type { ActivityItem } from '@/lib/api';

export type DecisionCategory = 'estimate' | 'schedule' | 'approval' | 'room' | 'payment';

export type DecisionHistoryItem = {
  id: string;
  category: DecisionCategory;
  categoryLabel: string;
  title: string;
  body?: string | null;
  at: string;
  linkPath?: string | null;
  actorHint?: string;
};

const CATEGORY_LABELS: Record<DecisionCategory, string> = {
  estimate: 'Смета',
  schedule: 'Сроки',
  approval: 'Согласование',
  room: 'Комнаты',
  payment: 'Оплата',
};

const DECISION_KINDS = new Set(['approval', 'room_change', 'schedule', 'estimate', 'payment', 'change_order']);

function haystack(item: ActivityItem): string {
  return `${item.title} ${item.body || ''}`.toLowerCase();
}

/** Классификация события — только решения, не шум материалов/логов */
export function classifyDecision(item: ActivityItem): DecisionCategory | null {
  const text = haystack(item);
  const kind = item.kind;

  if (kind === 'approval' || kind === 'change_order') return 'approval';
  if (/соглас|доп\.?\s*работ|change.?order|одобр|отклон/i.test(text)) return 'approval';
  if (/смет|estimate|строк.*смет|бюджет.*план/i.test(text)) return 'estimate';
  if (kind === 'schedule' || /срок|перенос|график|календар|дата.*этап|продл/i.test(text)) return 'schedule';
  if (kind === 'room_change' || /комнат|площад|этаж.*измен/i.test(text)) return 'room';
  if (kind === 'payment' || /оплат|перевод|чек|payment/i.test(text)) return 'payment';

  if (DECISION_KINDS.has(kind)) {
    if (kind === 'material') return null;
    return 'approval';
  }

  return null;
}

function extractActorHint(item: ActivityItem): string | undefined {
  const m = item.title.match(/^([^·—–]+)[·—–]/);
  if (m?.[1]?.trim()) return m[1].trim();
  const bodyActor = item.body?.match(/^(исполнитель|заказчик|подрядчик)/i);
  if (bodyActor) return bodyActor[0];
  return undefined;
}

function matchesStage(item: ActivityItem, stageId?: string): boolean {
  if (!stageId) return true;
  if (item.link_path?.includes(stageId)) return true;
  const text = haystack(item);
  return text.includes(stageId.slice(0, 8).toLowerCase());
}

export function buildDecisionHistory(
  items: ActivityItem[],
  opts?: { stageId?: string; limit?: number },
): DecisionHistoryItem[] {
  const limit = opts?.limit ?? 50;
  const out: DecisionHistoryItem[] = [];

  for (const item of items) {
    if (!matchesStage(item, opts?.stageId)) continue;
    const category = classifyDecision(item);
    if (!category) continue;
    out.push({
      id: item.id,
      category,
      categoryLabel: CATEGORY_LABELS[category],
      title: item.title,
      body: item.body,
      at: item.at,
      linkPath: item.link_path,
      actorHint: extractActorHint(item),
    });
    if (out.length >= limit) break;
  }

  return out;
}

export const DECISION_FILTER_CHIPS: { key: DecisionCategory | 'all'; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'approval', label: 'Согласования' },
  { key: 'estimate', label: 'Смета' },
  { key: 'schedule', label: 'Сроки' },
  { key: 'room', label: 'Комнаты' },
  { key: 'payment', label: 'Оплата' },
];

export function filterDecisionHistory(
  items: DecisionHistoryItem[],
  category: DecisionCategory | 'all',
): DecisionHistoryItem[] {
  if (category === 'all') return items;
  return items.filter((i) => i.category === category);
}
