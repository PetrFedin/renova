/** Readiness and retry policy for non-critical hub URL synchronization. */

export const HUB_TAB_SYNC_RETRY_DELAYS_MS = [0, 16, 32, 64, 128, 250, 500] as const;

type NavigationContainerRefLike = {
  current?: {
    isReady?: () => boolean;
  } | null;
};

/** Expo Router may expose root state before its NavigationContainer is ready. */
export function isHubNavigationReady(ref: NavigationContainerRefLike): boolean {
  return Boolean(ref.current?.isReady?.());
}

/** Known transient Expo Router race; safe to retry without crashing the hub. */
export function isRootLayoutMountRace(error: unknown): boolean {
  return error instanceof Error
    && error.message.includes('Attempted to navigate before mounting the Root Layout component');
}
