import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import 'react-native-reanimated';
import NetInfo from '@react-native-community/netinfo';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { RenovaProvider, useRenova } from '@/lib/context/RenovaContext';
import { RenovaTheme } from '@/constants/Theme';
import { NavTracker } from '@/components/renova/NavTracker';
import { flushOfflineOutbox, isOnline, startOfflineFlushScheduler, subscribeOfflineFlush } from '@/lib/offline';
import { getQueue } from '@/lib/offlineQueue';
import { pollingResumesInMs } from '@/lib/api/client';
import { currentSessionUserId } from '@/lib/domain/sessionAuthority';
import { initLang } from '@/lib/i18n';
import { pushOsNav } from '@/lib/pushOsNav';
import {
  createPendingNavigationQueue,
  type NotificationSession,
  type PendingNavigationQueue,
} from '@/lib/notificationNavigation';
import { initSentry } from '@/lib/sentryInit';
import { reportCatch, reportError } from '@/lib/reportError';
import {
  installNativeNotificationInteractions,
  scheduleNativeSyncConflictNotification,
} from '@/lib/nativeNotifications';

/** Единый фон экранов: без него стек-экраны (Заявки, Админ, Работа) рисовались серым #f2f2f2 рядом с #F8FAFC вкладок. */
const ROOT_STACK_OPTIONS = {
  headerShown: false,
  animation: 'slide_from_right',
  contentStyle: { backgroundColor: RenovaTheme.colors.background },
} as const;

SplashScreen.preventAutoHideAsync();
initSentry();

function SplashGate({ children }: { children: ReactNode }) {
  const { loading } = useRenova();
  useEffect(() => {
    if (!loading) SplashScreen.hideAsync().catch(reportCatch('splash.hide'));
  }, [loading]);
  return children;
}

/**
 * Push-tap navigation (COM-002/COM-040). Lives inside RenovaProvider so a tap
 * that cold-starts the app is held until the session is restored, then opened
 * with the payload role or, failing that, the signed-in user's role.
 */
function NotificationNavigationBridge() {
  const { loading, user } = useRenova();
  const sessionRef = useRef<NotificationSession>({ status: 'loading' });
  const queueRef = useRef<PendingNavigationQueue | null>(null);
  sessionRef.current = loading
    ? { status: 'loading' }
    : user
      ? { status: 'authenticated', role: user.role === 'contractor' ? 'contractor' : 'customer' }
      : { status: 'anonymous' };

  useEffect(() => {
    let disposed = false;
    let removeNotificationListener: () => void = () => undefined;
    const queue = createPendingNavigationQueue({
      getSession: () => sessionRef.current,
      navigate: ({ linkPath, returnTo }, role) => {
        if (linkPath) pushOsNav(linkPath, returnTo, role);
      },
      onDropped: (reason, payload) =>
        reportError('notifications.deferred_navigation_dropped', new Error(reason), { linkPath: payload.linkPath }),
    });
    queueRef.current = queue;

    // Native notification APIs are loaded only on Android/iOS. Importing the
    // module on web installs unsupported listeners and creates false runtime
    // errors in observability even though the application itself is healthy.
    void installNativeNotificationInteractions(
      (payload) => queue.push(payload),
      (scope, error) => reportError(scope, error),
    ).then((remove) => {
      if (disposed) remove();
      else removeNotificationListener = remove;
    }).catch(reportCatch('notifications.setup'));

    return () => {
      disposed = true;
      removeNotificationListener();
      queue.dispose();
      queueRef.current = null;
    };
  }, []);

  useEffect(() => {
    queueRef.current?.sessionChanged();
  }, [loading, user?.id, user?.role]);

  return null;
}

export default function RootLayout() {
  useEffect(() => { initLang().catch(reportCatch('i18n.init')); }, []);

  useEffect(() => {
    const apiBase = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100';
    // W93: online → канон flushOfflineOutbox (offlineFlush + projectDataBus)
    const onOnline = () => flushOfflineOutbox(apiBase).then((result) => {
      if (result.conflicts > 0) {
        void scheduleNativeSyncConflictNotification(result.conflicts)
          .catch(reportCatch('notifications.conflict'));
      }
    }).catch(reportCatch('offline.flushOnline'));

    const unsubNet = NetInfo.addEventListener((state) => {
      if (state.isConnected) onOnline();
    });
    // CMP-015: таймер на ближайший nextAttemptAt — отложенные задания уходят без ручной синхронизации.
    const stopFlushScheduler = startOfflineFlushScheduler({
      getJobs: getQueue,
      flush: () => flushOfflineOutbox(apiBase),
      isOnline,
      subscribe: subscribeOfflineFlush,
      getUserId: currentSessionUserId,
      pausedForMs: pollingResumesInMs,
      onError: reportCatch('offline.flushScheduler'),
    });
    if (typeof window !== 'undefined') window.addEventListener('online', onOnline);

    return () => {
      unsubNet();
      stopFlushScheduler();
      if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
    };
  }, []);

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <RenovaProvider>
        <SplashGate>
          <StatusBar style="dark" />
          <NavTracker />
          <NotificationNavigationBridge />
          <Stack screenOptions={ROOT_STACK_OPTIONS}>
            <Stack.Screen name="index" />
            <Stack.Screen name="onboarding/[step]" options={{ title: 'Онбординг' }} />
            <Stack.Screen name="wizard" options={{ presentation: 'modal' }} />
            <Stack.Screen name="(customer)" />
            <Stack.Screen name="(contractor)" />
            <Stack.Screen name="room/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="stage/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="chat/[threadId]" />
            <Stack.Screen name="article/[slug]" options={{ headerShown: false }} />
            <Stack.Screen name="contractor-wizard/[leadId]" options={{ headerShown: false }} />
            <Stack.Screen name="[slug]" options={{ headerShown: false }} />
            <Stack.Screen name="approvals" options={{ headerShown: false }} />
            <Stack.Screen name="activity" options={{ headerShown: false }} />
            <Stack.Screen name="documents" options={{ headerShown: false }} />
            <Stack.Screen name="portfolio" options={{ headerShown: false }} />
            <Stack.Screen name="reports" options={{ headerShown: false }} />
            <Stack.Screen name="guide" options={{ headerShown: false }} />
            <Stack.Screen name="job-leads" options={{ headerShown: false }} />
            <Stack.Screen name="inbox" options={{ headerShown: false }} />
            <Stack.Screen name="notification-center" options={{ headerShown: false }} />
            <Stack.Screen name="scan-receipt" options={{ presentation: 'modal', headerShown: false }} />
            <Stack.Screen name="payment-return" options={{ headerShown: false }} />
            <Stack.Screen name="portal" options={{ headerShown: false }} />
          </Stack>
        </SplashGate>
      </RenovaProvider>
    </SafeAreaProvider>
  );
}
