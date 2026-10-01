/**
 * Push token <-> account binding on this device (COM-017).
 *
 * The server binds an Expo token to the user who registered it; without an
 * explicit unbind the next account on the same device keeps receiving the
 * previous user's notifications. The token is remembered at registration so
 * logout can detach exactly this device. Pure (storage / network injected) so
 * it is unit-testable; it never throws and is time-bounded, because a failed
 * unbind must not block signing out.
 */
export const PUSH_TOKEN_STORAGE_KEY = 'renova_push_token';
export const DETACH_TIMEOUT_MS = 4_000;

export type KeyValueStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export async function rememberPushToken(
  storage: KeyValueStore,
  token: string,
  onError?: (error: unknown) => void,
): Promise<void> {
  try {
    await storage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
  } catch (error) {
    // Best effort: without it logout falls back to "detach all my tokens".
    onError?.(error);
  }
}

export type DetachOutcome = 'detached' | 'failed';

/**
 * Detach this device's token from the signed-in user on the server.
 * `unregister(token)` is called with the remembered token, or `undefined`
 * (server removes the caller's tokens) when none was remembered.
 */
export async function detachPushToken(deps: {
  storage: KeyValueStore;
  unregister: (token?: string) => Promise<unknown>;
  timeoutMs?: number;
  onError?: (error: unknown) => void;
}): Promise<DetachOutcome> {
  const timeoutMs = deps.timeoutMs ?? DETACH_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    let token: string | undefined;
    try {
      token = (await deps.storage.getItem(PUSH_TOKEN_STORAGE_KEY)) || undefined;
    } catch (error) {
      deps.onError?.(error);
      token = undefined;
    }
    await Promise.race([
      deps.unregister(token),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('push_detach_timeout')), timeoutMs);
      }),
    ]);
    try {
      await deps.storage.removeItem(PUSH_TOKEN_STORAGE_KEY);
    } catch (error) {
      deps.onError?.(error);
    }
    return 'detached';
  } catch (error) {
    deps.onError?.(error);
    return 'failed';
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
