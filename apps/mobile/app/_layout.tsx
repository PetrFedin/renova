import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import 'react-native-reanimated';
import NetInfo from '@react-native-community/netinfo';
import * as Notifications from 'expo-notifications';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { RenovaProvider, useRenova } from '@/lib/context/RenovaContext';
import { NavTracker } from '@/components/renova/NavTracker';
import { flush } from '@/lib/offlineQueue';
import { initLang } from '@/lib/i18n';
import { resolvePushLink } from '@/lib/pushLinks';

SplashScreen.preventAutoHideAsync();

function SplashGate({ children }: { children: ReactNode }) {
  const { loading } = useRenova();
  useEffect(() => {
    if (!loading) SplashScreen.hideAsync().catch(() => {});
  }, [loading]);
  return children;
}

export default function RootLayout() {
  useEffect(() => { initLang().catch(() => {}); }, []);

  useEffect(() => {
    Notifications.setNotificationCategoryAsync('STAGE', [{ identifier: 'OPEN', buttonTitle: 'Открыть', options: { opensAppToForeground: true } }]).catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const link = r.notification.request.content.data?.link_path as string | undefined;
      const returnTo = r.notification.request.content.data?.return_to as string | undefined;
      const target = resolvePushLink(link, returnTo);
      if (target) router.push(target as any);
    });
    const apiBase = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100';
    const onOnline = () => flush(apiBase).then((r) => {
      if (r.conflicts > 0 && typeof window !== 'undefined') {
        import('expo-notifications').then((N) => N.scheduleNotificationAsync({
          content: { title: 'Конфликт синхронизации', body: `${r.conflicts} изменений требуют решения`, data: { link_path: '/conflicts', return_to: '/' } },
          trigger: null,
        })).catch(() => {});
      }
    }).catch(() => {});
    const unsubNet = NetInfo.addEventListener((st) => { if (st.isConnected) onOnline(); });
    if (typeof window !== 'undefined') window.addEventListener('online', onOnline);
    return () => { sub.remove(); unsubNet(); if (typeof window !== 'undefined') window.removeEventListener('online', onOnline); };
  }, []);

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <RenovaProvider>
        <SplashGate>
          <StatusBar style="dark" />
          <NavTracker />
          <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="onboarding/role" />
            <Stack.Screen name="onboarding/project" />
            <Stack.Screen name="onboarding/detail-quiz" options={{ title: 'Детализация' }} />
            <Stack.Screen name="wizard" options={{ presentation: 'modal' }} />
            <Stack.Screen name="(customer)" />
            <Stack.Screen name="(contractor)" />
            <Stack.Screen name="room/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="stage/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="chat/[threadId]" />
            <Stack.Screen name="article/[slug]" options={{ headerShown: false }} />
            <Stack.Screen name="contractor-wizard/[leadId]" options={{ headerShown: false }} />
            <Stack.Screen name="job-leads" options={{ headerShown: false }} />
            <Stack.Screen name="portfolio" options={{ headerShown: false }} />
            <Stack.Screen name="reports" options={{ headerShown: false }} />
            <Stack.Screen name="design" options={{ headerShown: false }} />
            <Stack.Screen name="approvals" options={{ headerShown: false }} />
            <Stack.Screen name="activity" options={{ headerShown: false }} />
            <Stack.Screen name="documents" options={{ headerShown: false }} />
            <Stack.Screen name="conflicts" options={{ headerShown: false }} />
            <Stack.Screen name="scan-receipt" options={{ presentation: 'modal', headerShown: false }} />
          </Stack>
        </SplashGate>
      </RenovaProvider>
    </SafeAreaProvider>
  );
}
