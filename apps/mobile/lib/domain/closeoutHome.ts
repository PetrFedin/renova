/** W79: closeout-checklist → inbox / nextAction (тот же SoT, что DocumentsHub). */
import type { InboxItem } from './buildInboxItems';

export type CloseoutHint = {
  ready?: boolean;
  archived?: boolean;
  next_action?: string;
  warranty_open?: number;
  pending_payments?: number;
  acceptance_acts_active?: number;
  all_stages_done?: boolean;
};

/** Строка inbox, когда объект можно сдать или есть блокер закрытия. */
export function buildCloseoutInboxItem(hint: CloseoutHint | null | undefined): InboxItem | null {
  if (!hint || hint.archived) return null;
  if (!hint.all_stages_done && !hint.ready) return null;

  if (hint.ready) {
    return {
      id: 'closeout-ready',
      kind: 'closeout',
      title: 'Завершить объект',
      sub: hint.next_action || 'Чеклист закрытия готов',
      href: '/documents',
      priority: 91,
    };
  }

  // Этапы закрыты, но есть блокеры (оплаты / акты / гарантия)
  if (hint.all_stages_done) {
    return {
      id: 'closeout-blocked',
      kind: 'closeout',
      title: 'Закрытие объекта',
      sub: hint.next_action || 'Есть незакрытые пункты',
      href: '/documents',
      priority: 72,
    };
  }
  return null;
}

export function mergeCloseoutInboxItem(
  items: InboxItem[],
  hint: CloseoutHint | null | undefined,
): InboxItem[] {
  const without = items.filter((i) => i.id !== 'closeout-ready' && i.id !== 'closeout-blocked');
  const row = buildCloseoutInboxItem(hint);
  if (!row) return without;
  return [...without, row].sort((a, b) => b.priority - a.priority);
}

/** Подсказка для hero при isComplete. */
export function closeoutNextActionTitle(hint: CloseoutHint | null | undefined): {
  title: string;
  subtitle: string;
  ready: boolean;
} | null {
  if (!hint || hint.archived) return null;
  if (hint.ready) {
    return {
      title: 'Завершить объект',
      subtitle: hint.next_action || 'Чеклист закрытия готов · Документы',
      ready: true,
    };
  }
  if (hint.all_stages_done) {
    return {
      title: 'Закрытие объекта',
      subtitle: hint.next_action || 'Проверьте акты, оплаты и гарантию',
      ready: false,
    };
  }
  return null;
}
