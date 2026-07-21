/**
 * Чистая логика invalidation/apply для unread sync (без RN / API).
 * Используется inboxSyncStore и unit-тестами.
 */

export type ReloadMeta = {
  requestSequence: number;
  userId: string;
  startedAtMutationRevision: number;
};

export type RevisionState = {
  serverRevision: number;
  localMutationRevision: number;
  reloadRequestSequence: number;
};

export function canApplyReload(
  meta: ReloadMeta,
  state: { storeUserId: string | null; reloadRequestSequence: number; localMutationRevision: number },
): boolean {
  if (!state.storeUserId || state.storeUserId !== meta.userId) return false;
  if (meta.requestSequence !== state.reloadRequestSequence) return false;
  if (meta.startedAtMutationRevision !== state.localMutationRevision) return false;
  return true;
}

/** Инвалидация in-flight reload при optimistic mark-read */
export function bumpMutationInvalidation(state: RevisionState): RevisionState {
  return {
    ...state,
    localMutationRevision: state.localMutationRevision + 1,
    reloadRequestSequence: state.reloadRequestSequence + 1,
  };
}

export function nextReloadMeta(
  state: RevisionState,
  userId: string,
): { state: RevisionState; meta: ReloadMeta } {
  const reloadRequestSequence = state.reloadRequestSequence + 1;
  const next = { ...state, reloadRequestSequence };
  return {
    state: next,
    meta: {
      requestSequence: reloadRequestSequence,
      userId,
      startedAtMutationRevision: state.localMutationRevision,
    },
  };
}

export function sumActiveUnread(threads: { unread_count?: number; is_archived?: boolean }[]): number {
  return threads
    .filter((t) => !t.is_archived)
    .reduce((sum, t) => sum + (t.unread_count || 0), 0);
}

/** Visible focused+foreground: badge как будто уже прочитано */
export function totalAsIfThreadRead(
  totalUnread: number,
  threadUnread: number,
): number {
  return Math.max(0, totalUnread - Math.max(0, threadUnread));
}

export function createEventLru(max = 64) {
  const ids: string[] = [];
  const set = new Set<string>();
  return {
    /** @returns true если дубликат */
    remember(id: string): boolean {
      if (!id) return false;
      if (set.has(id)) return true;
      set.add(id);
      ids.push(id);
      while (ids.length > max) {
        const old = ids.shift();
        if (old) set.delete(old);
      }
      return false;
    },
  };
}
