import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import 'react-native-reanimated';
import NetInfo from '@react-native-community/netinfo';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { RenovaProvider, useRenova } from '@/lib/context/RenovaContext';
import { NavTracker } from '@/components/renova/NavTracker';
import { flushOfflineOutbox } from '@/lib/offline';
import { initLang } from '@/lib/i18n';
import { pushOsNav } from '@/lib/pushOsNav';
import { initSentry } from '@/lib/sentryInit';
import { reportCatch, reportError } from '@/lib/reportError';
import {
  installNativeNotificationInteractions,
  scheduleNativeSyncConflictNotification,
} from '@/lib/nativeNotifications';

SplashScreen.preventAutoHideAsync();
initSentry();

function SplashGate({ children }: { children: ReactNode }) {
  const { loading } = useRenova();
  useEffect(() => {
    if (!loading) SplashScreen.hideAsync().catch(reportCatch('splash.hide'));
  }, [loading]);
  return children;
}

export default function RootLayout() {
  useEffect(() => { initLang().catch(reportCatch('i18n.init')); }, []);

  useEffect(() => {
    let disposed = false;
    let removeNotificationListener: () => void = () => undefined;

    // Native notification APIs are loaded only on Android/iOS. Importing the
    // module on web installs unsupported listeners and creates false runtime
    // errors in observability even though the application itself is healthy.
    void installNativeNotificationInteractions(
      ({ linkPath, returnTo, role }) => {
        if (linkPath) pushOsNav(linkPath, returnTo, role);
      },
      (scope, error) => reportError(scope, error),
    ).then((remove) => {
      if (disposed) remove();
      else removeNotificationListener = remove;
    }).catch(reportCatch('notifications.setup'));

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
    if (typeof window !== 'undefined') window.addEventListener('online', onOnline);

    return () => {
      disposed = true;
      removeNotificationListener();
      unsubNet();
      if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
    };
  }, []);

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <RenovaProvider>
        <SplashGate>
          <StatusBar style="dark" />
          <NavTracker />
          <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
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
            <Stack.Screen name="inbox" options={{ headerShown: false }} />
            <Stack.Screen name="scan-receipt" options={{ presentation: 'modal', headerShown: false }} />
            <Stack.Screen name="payment-return" options={{ headerShown: false }} />
            <Stack.Screen name="portal" options={{ headerShown: false }} />
          </Stack>
        </SplashGate>
      </RenovaProvider>
    </SafeAreaProvider>
  );
}
