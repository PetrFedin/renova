/** W78: офлайн-очередь → единый inbox (те же storage, что OfflineQueue). */
import type { InboxItem } from './buildInboxItems';

export type OfflineQueueHint = {
  pending?: number;
  blocked?: number;
  conflicts?: number;
};

/** Строка inbox: «отправить / разобрать» локальные действия. */
export function buildOfflineInboxItem(hint: OfflineQueueHint): InboxItem | null {
  const pending = Math.max(0, hint.pending ?? 0);
  const blocked = Math.max(0, hint.blocked ?? 0);
  const conflicts = Math.max(0, hint.conflicts ?? 0);
  const total = pending + blocked + conflicts;
  if (total <= 0) return null;

  if (blocked > 0 || conflicts > 0) {
    const parts: string[] = [];
    if (conflicts) parts.push(`${conflicts} конфликт`);
    if (blocked) parts.push(`${blocked} блок`);
    if (pending) parts.push(`${pending} ждут`);
    return {
      id: 'offline-queue',
      kind: 'offline',
      title: 'Разобрать офлайн-очередь',
      sub: parts.join(' · '),
    href: '/inbox',
    priority: 92,
    };
  }

  return {
    id: 'offline-queue',
    kind: 'offline',
    title: pending === 1 ? 'Отправить 1 офлайн-действие' : `Отправить ${pending} офлайн`,
    sub: 'Синхронизация во «Входящих»',
    href: '/inbox',
    priority: 74,
  };
}

/** Подмешать offline-строку без дубля id. */
export function mergeOfflineInboxItem(items: InboxItem[], hint: OfflineQueueHint): InboxItem[] {
  const row = buildOfflineInboxItem(hint);
  const without = items.filter((i) => i.id !== 'offline-queue');
  if (!row) return without;
  return [...without, row].sort((a, b) => b.priority - a.priority);
}
