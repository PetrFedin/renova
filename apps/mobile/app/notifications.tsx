import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * P3-W34 IA: /notifications → /inbox (единый attention channel).
 * Deep links / push с старым path не ломаются.
 */
export default function NotificationsRedirect() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const returnTo = params.returnTo;
  const rt = Array.isArray(returnTo) ? returnTo[0] : returnTo;
  return (
    <Redirect
      href={{
        pathname: '/inbox',
        params: rt ? { returnTo: rt } : undefined,
      }}
    />
  );
}
