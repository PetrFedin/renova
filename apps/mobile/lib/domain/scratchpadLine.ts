/** Парсинг ввода в черновик — чеклисты и покупки без отдельной формы. */
import type { ScratchpadLine, ScratchpadLineKind } from '@/lib/api/types/scratchpad';

const CHECKLIST_OPEN = /^(-\s*)?\[\s*\]\s*/i;
const CHECKLIST_DONE = /^(-\s*)?\[x\]\s*/i;
const PURCHASE = /^(🛒|#покупк|#buy)\s*/i;

export function parseScratchpadInput(raw: string): { text: string; line_kind: ScratchpadLineKind; done: boolean } {
  let s = raw.trim();
  if (!s) return { text: '', line_kind: 'note', done: false };
  let done = false;
  let m = CHECKLIST_DONE.exec(s);
  if (m) {
    done = true;
    s = s.slice(m[0].length).trim();
    return { text: s || 'Пункт', line_kind: 'checklist', done: true };
  }
  m = CHECKLIST_OPEN.exec(s);
  if (m) {
    s = s.slice(m[0].length).trim();
    return { text: s || 'Пункт', line_kind: 'checklist', done: false };
  }
  m = PURCHASE.exec(s);
  if (m) {
    s = s.slice(m[0].length).trim();
    return { text: s || 'Покупка', line_kind: 'purchase', done: false };
  }
  return { text: s, line_kind: 'note', done: false };
}

export function scratchpadKindLabel(kind: ScratchpadLineKind): string {
  if (kind === 'checklist') return 'Дело';
  if (kind === 'purchase') return 'Покупка';
  return 'Заметка';
}

export function promotedLabel(line: ScratchpadLine): string | null {
  if (!line.promoted_kind) return null;
  if (line.promoted_kind === 'work_order') return '→ задача';
  if (line.promoted_kind === 'chat') return '→ чат';
  if (line.promoted_kind === 'expense') return '→ расход';
  return '→ оформлено';
}

export function isCheckableKind(kind: ScratchpadLineKind): boolean {
  return kind === 'checklist' || kind === 'purchase';
}
