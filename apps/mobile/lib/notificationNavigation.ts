/**
 * Pure helpers for opening a screen from a push tap (no react-native imports,
 * so they are unit-testable with tsx).
 *
 * COM-002: the role comes from the push payload (server puts the recipient's
 * role there); when it is absent the signed-in user's role is used. Never a
 * hard-coded "customer" default, which sent contractors into customer tabs.
 * COM-040: a cold-start tap can arrive before the session is restored; the
 * navigation is held in a bounded queue until the session is ready.
 */
export type NotificationRole = 'customer' | 'contractor';

export type NotificationNavigationPayload = {
  linkPath?: string;
  returnTo?: string;
  /** Role carried by the push payload; undefined for legacy pushes. */
  role?: NotificationRole;
};

export function parseNotificationRole(value: unknown): NotificationRole | undefined {
  return value === 'contractor' || value === 'customer' ? value : undefined;
}

export function notificationNavigationPayload(
  data: Record<string, unknown> | undefined,
): NotificationNavigationPayload {
  const linkPath = typeof data?.link_path === 'string' ? data.link_path : undefined;
  const returnToValue = data?.return_to ?? data?.returnTo;
  const returnTo = typeof returnToValue === 'string' ? returnToValue : undefined;
  return { linkPath, returnTo, role: parseNotificationRole(data?.role) };
}

/** Payload role wins; otherwise the session role; otherwise unknown (caller must wait/drop). */
export function resolveNotificationRole(
  payloadRole: NotificationRole | undefined,
  sessionRole: NotificationRole | undefined,
): NotificationRole | undefined {
  return payloadRole ?? sessionRole;
}

export type NotificationSession =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; role: NotificationRole };

export const DEFAULT_PENDING_NAV_TIMEOUT_MS = 20_000;

export type PendingNavigationQueue = {
  /** Open now when the session allows it, otherwise hold (latest tap wins). */
  push(payload: NotificationNavigationPayload): void;
  /** Call whenever the session state may have changed. */
  sessionChanged(): void;
  dispose(): void;
};

type QueueDeps = {
  getSession: () => NotificationSession;
  navigate: (payload: NotificationNavigationPayload, role: NotificationRole) => void;
  timeoutMs?: number;
  onDropped?: (reason: 'timeout' | 'anonymous' | 'no_role', payload: NotificationNavigationPayload) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

/**
 * Deferred-navigation queue. While the session is loading the tap is held (at
 * most one — a newer tap replaces an older one) and flushed as soon as the
 * session is authenticated. It never waits forever: after `timeoutMs` the tap
 * is dropped, and a tap that meets a signed-out session is dropped at once
 * (protected screens would only bounce to onboarding).
 */
export function createPendingNavigationQueue(deps: QueueDeps): PendingNavigationQueue {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_PENDING_NAV_TIMEOUT_MS;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let pending: NotificationNavigationPayload | null = null;
  let timer: unknown = null;
  let disposed = false;

  const clear = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    pending = null;
  };

  const attempt = (payload: NotificationNavigationPayload): boolean => {
    const session = deps.getSession();
    if (session.status === 'loading') return false;
    if (session.status === 'anonymous') {
      deps.onDropped?.('anonymous', payload);
      return true;
    }
    const role = resolveNotificationRole(payload.role, session.role);
    if (!role) {
      deps.onDropped?.('no_role', payload);
      return true;
    }
    deps.navigate(payload, role);
    return true;
  };

  return {
    push(payload) {
      if (disposed) return;
      if (timer !== null) clearTimer(timer);
      timer = null;
      pending = null;
      if (attempt(payload)) return;
      pending = payload;
      timer = setTimer(() => {
        const dropped = pending;
        clear();
        if (dropped) deps.onDropped?.('timeout', dropped);
      }, timeoutMs);
    },
    sessionChanged() {
      if (disposed || !pending) return;
      const payload = pending;
      if (attempt(payload)) clear();
    },
    dispose() {
      disposed = true;
      clear();
    },
  };
}
