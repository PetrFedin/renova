/**
 * Process-local authority fence for all authenticated async work.
 *
 * `userId` is not a sufficient identity: A -> B -> A must invalidate the first
 * A generation. `sessionId` survives app restart for the same persisted login,
 * while `generation` invalidates every in-flight operation inside this process.
 */
export type SessionAuthoritySnapshot = Readonly<{
  generation: number;
  userId: string | null;
  sessionId: string | null;
}>;

let generation = 0;
let activeUserId: string | null = null;
let activeSessionId: string | null = null;
let authorityWriteChain: Promise<void> = Promise.resolve();

function newSessionId(): string {
  const cryptoApi = typeof globalThis !== 'undefined'
    ? (globalThis as typeof globalThis & { crypto?: { randomUUID?: () => string } }).crypto
    : undefined;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  const now = Date.now().toString(36);
  const a = Math.random().toString(36).slice(2, 12);
  const b = Math.random().toString(36).slice(2, 12);
  return `session-${now}-${a}-${b}`;
}

export function captureSessionAuthority(): SessionAuthoritySnapshot {
  return Object.freeze({
    generation,
    userId: activeUserId,
    sessionId: activeSessionId,
  });
}

/** Start a new logical login, even when the user id equals the previous login. */
export function beginSessionAuthority(userId: string): SessionAuthoritySnapshot {
  if (!userId) throw new Error('session_authority_user_required');
  generation += 1;
  activeUserId = userId;
  activeSessionId = newSessionId();
  return captureSessionAuthority();
}

/** Restore the same persisted login after app restart; missing provenance fails safe to a new id. */
export function restoreSessionAuthority(
  userId: string,
  persistedSessionId?: string | null,
): SessionAuthoritySnapshot {
  if (!userId) throw new Error('session_authority_user_required');
  generation += 1;
  activeUserId = userId;
  activeSessionId = persistedSessionId?.trim() || newSessionId();
  return captureSessionAuthority();
}

/** Invalidate local authority synchronously before any logout/storage/network await. */
export function invalidateSessionAuthority(): SessionAuthoritySnapshot {
  generation += 1;
  activeUserId = null;
  activeSessionId = null;
  return captureSessionAuthority();
}

export function isSessionAuthorityCurrent(snapshot: SessionAuthoritySnapshot): boolean {
  return snapshot.generation === generation
    && snapshot.userId === activeUserId
    && snapshot.sessionId === activeSessionId;
}

export function currentSessionIdForUser(userId: string): string | null {
  return userId && userId === activeUserId ? activeSessionId : null;
}

export function isCurrentSessionOwner(userId: string, sessionId?: string | null): boolean {
  return Boolean(
    userId
      && sessionId
      && userId === activeUserId
      && sessionId === activeSessionId,
  );
}

export class SessionAuthorityChangedError extends Error {
  code = 'session_generation_changed' as const;
  constructor() {
    super('Session authority changed while the operation was in flight.');
    this.name = 'SessionAuthorityChangedError';
  }
}

export function assertSessionAuthorityCurrent(snapshot: SessionAuthoritySnapshot): void {
  if (!isSessionAuthorityCurrent(snapshot)) throw new SessionAuthorityChangedError();
}

/**
 * Serialize session-owned durable publications (user/project/session keys).
 * If an old write is already inside the storage driver when authority changes,
 * the next generation's write waits behind it and therefore owns final state.
 */
export function withSessionAuthorityWrite<T>(
  snapshot: SessionAuthoritySnapshot,
  operation: () => Promise<T>,
): Promise<T> {
  const run = authorityWriteChain.then(async () => {
    assertSessionAuthorityCurrent(snapshot);
    const value = await operation();
    assertSessionAuthorityCurrent(snapshot);
    return value;
  }, async () => {
    assertSessionAuthorityCurrent(snapshot);
    const value = await operation();
    assertSessionAuthorityCurrent(snapshot);
    return value;
  });
  authorityWriteChain = run.then(() => undefined, () => undefined);
  return run;
}
