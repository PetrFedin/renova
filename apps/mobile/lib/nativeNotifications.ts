import { Platform } from 'react-native';
import {
  createNotificationDeliveryRunner,
  notificationDeliveryId,
} from '@/lib/notificationDeliveryDedup';
import {
  isNativeNotificationPlatform,
  shouldScheduleNativeConflictNotification,
} from '@/lib/nativeNotificationPolicy';

export type NotificationNavigationPayload = {
  linkPath?: string;
  returnTo?: string;
  role: 'customer' | 'contractor';
};

type NotificationSetupError = (
  scope:
    | 'notifications.category'
    | 'notifications.listener'
    | 'notifications.response'
    | 'notifications.cold_start'
    | 'notifications.storage',
  error: unknown,
) => void;

type NotificationResponseLike = {
  notification: {
    request: {
      content: {
        data?: unknown;
      };
    };
  };
};

export function supportsNativeNotifications(platform = Platform.OS): boolean {
  return isNativeNotificationPlatform(platform);
}

function navigationPayload(data: Record<string, unknown> | undefined): NotificationNavigationPayload {
  const linkPath = typeof data?.link_path === 'string' ? data.link_path : undefined;
  const returnToValue = data?.return_to ?? data?.returnTo;
  const returnTo = typeof returnToValue === 'string' ? returnToValue : undefined;
  return {
    linkPath,
    returnTo,
    role: data?.role === 'contractor' ? 'contractor' : 'customer',
  };
}

function responseData(response: NotificationResponseLike): Record<string, unknown> | undefined {
  const raw = response.notification.request.content.data;
  return typeof raw === 'object' && raw !== null
    ? (raw as Record<string, unknown>)
    : undefined;
}

/**
 * Register notification actions and response navigation only on platforms where
 * expo-notifications implements them. The dynamic import is intentional: even
 * importing expo-notifications on web installs unsupported listeners and emits
 * runtime warnings that pollute release observability.
 *
 * Live and cold-start responses share one serialized delivery runner. A stable
 * delivery identity is persisted only after navigation succeeds, so duplicate
 * responses are suppressed without making a failed navigation unretryable.
 */
export async function installNativeNotificationInteractions(
  onOpen: (payload: NotificationNavigationPayload) => void,
  onError?: NotificationSetupError,
): Promise<() => void> {
  if (!supportsNativeNotifications()) return () => undefined;

  const Notifications = await import('expo-notifications');
  let runNotificationDelivery = async (
    _deliveryId: string | undefined,
    action: () => void | Promise<void>,
  ): Promise<boolean> => {
    await action();
    return true;
  };
  try {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    runNotificationDelivery = createNotificationDeliveryRunner(AsyncStorage);
  } catch (error) {
    onError?.('notifications.storage', error);
  }

  const handleResponse = async (response: NotificationResponseLike): Promise<void> => {
    const data = responseData(response);
    await runNotificationDelivery(notificationDeliveryId(data), () => onOpen(navigationPayload(data)));
  };

  try {
    await Notifications.setNotificationCategoryAsync('STAGE', [
      {
        identifier: 'OPEN',
        buttonTitle: 'Открыть',
        options: { opensAppToForeground: true },
      },
    ]);
  } catch (error) {
    onError?.('notifications.category', error);
  }

  let subscription: { remove(): void };
  try {
    subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void handleResponse(response).catch((error) => {
        onError?.('notifications.response', error);
      });
    });
  } catch (error) {
    onError?.('notifications.listener', error);
    return () => undefined;
  }

  try {
    const lastResponse = await Notifications.getLastNotificationResponseAsync();
    if (lastResponse) {
      await handleResponse(lastResponse);
      await Notifications.clearLastNotificationResponseAsync();
    }
  } catch (error) {
    onError?.('notifications.cold_start', error);
  }

  return () => subscription.remove();
}

/**
 * Ask for push permission and persist the Expo token through a caller-provided
 * callback. Keeping the API write outside this module prevents a dependency
 * cycle while ensuring every login/bootstrap path shares the same native gate.
 */
export async function registerNativePushToken(
  persistToken: (token: string) => Promise<unknown>,
): Promise<boolean> {
  if (!supportsNativeNotifications()) return false;

  const Notifications = await import('expo-notifications');
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return false;

  const token = (await Notifications.getExpoPushTokenAsync()).data?.trim();
  if (!token) return false;
  await persistToken(token);
  return true;
}

/** Schedule a local conflict alert only on Android/iOS; web uses in-app UI. */
export async function scheduleNativeSyncConflictNotification(conflicts: number): Promise<boolean> {
  if (!shouldScheduleNativeConflictNotification(Platform.OS, conflicts)) {
    return false;
  }
  const Notifications = await import('expo-notifications');
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Конфликт синхронизации',
      body: `${Math.floor(conflicts)} изменений требуют решения`,
      data: { link_path: '/conflicts', return_to: '/' },
    },
    trigger: null,
  });
  return true;
}
