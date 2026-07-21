/**
 * Политика идемпотентного mark-read (без I/O).
 * Store использует это перед API и для in-flight coalesce.
 */

export type MarkThreadReadSource =
  | 'thread_visible'
  | 'thread_ws'
  | 'retry'
  | 'manual'
  | 'strict_remount';

export type ConfirmedReadCursor = {
  messageId: string | null;
  /** ISO created_at сообщения — для сравнения «старше/новее» */
  createdAt: string | null;
};

export type MarkReadDecision =
  | { action: 'send' }
  | { action: 'skip_same' }
  | { action: 'skip_stale' }
  | { action: 'await_inflight' };

export function decideMarkReadAction(opts: {
  force?: boolean;
  throughMessageId: string | null;
  throughCreatedAt: string | null;
  confirmed: ConfirmedReadCursor | null;
  hasInflight: boolean;
}): MarkReadDecision {
  if (opts.hasInflight) return { action: 'await_inflight' };
  if (opts.force) return { action: 'send' };

  const conf = opts.confirmed;
  if (conf) {
    if (
      opts.throughMessageId
      && conf.messageId
      && opts.throughMessageId === conf.messageId
    ) {
      return { action: 'skip_same' };
    }
    if (
      opts.throughCreatedAt
      && conf.createdAt
      && opts.throughCreatedAt < conf.createdAt
    ) {
      return { action: 'skip_stale' };
    }
  }
  return { action: 'send' };
}

/** Dev-only диагностика — без текста сообщений и PII */
export type MarkReadDiagEvent = {
  at: number;
  threadId: string;
  throughMessageId: string | null;
  source: MarkThreadReadSource;
  outcome:
    | 'sent'
    | 'deduplicated'
    | 'skipped_same'
    | 'skipped_stale'
    | 'skipped_background'
    | 'skipped_not_visible'
    | 'error'
    | 'patched';
};

const MAX_DIAG = 40;
let diagLog: MarkReadDiagEvent[] = [];

export function recordMarkReadDiag(ev: Omit<MarkReadDiagEvent, 'at'>): void {
  if (typeof __DEV__ !== 'undefined' && !__DEV__) return;
  diagLog = [...diagLog.slice(-(MAX_DIAG - 1)), { ...ev, at: Date.now() }];
}

export function getMarkReadDiagSnapshot(): MarkReadDiagEvent[] {
  return diagLog.slice();
}

export function clearMarkReadDiag(): void {
  diagLog = [];
}

/** Для тестов / remount: сброс confirmed cursors делается в store */
export function isSameCursor(
  a: ConfirmedReadCursor | null,
  messageId: string | null,
): boolean {
  if (!a || !messageId || !a.messageId) return false;
  return a.messageId === messageId;
}
