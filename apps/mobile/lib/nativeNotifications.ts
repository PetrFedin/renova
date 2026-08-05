import { Platform } from 'react-native';
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
  scope: 'notifications.category' | 'notifications.listener',
  error: unknown,
) => void;

export function supportsNativeNotifications(platform = Platform.OS): boolean {
  return isNativeNotificationPlatform(platform);
}

function navigationPayload(data: Record<string, unknown> | undefined): NotificationNavigationPayload {
  const linkPath = typeof data?.link_path === 'string' ? data.link_path : undefined;
  const returnTo = typeof data?.return_to === 'string' ? data.return_to : undefined;
  return {
    linkPath,
    returnTo,
    role: data?.role === 'contractor' ? 'contractor' : 'customer',
  };
}

/**
 * Register notification actions and response navigation only on platforms where
 * expo-notifications implements them. The dynamic import is intentional: even
 * importing expo-notifications on web installs unsupported listeners and emits
 * runtime warnings that pollute release observability.
 */
export async function installNativeNotificationInteractions(
  onOpen: (payload: NotificationNavigationPayload) => void,
  onError?: NotificationSetupError,
): Promise<() => void> {
  if (!supportsNativeNotifications()) return () => undefined;

  const Notifications = await import('expo-notifications');
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

  try {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      onOpen(navigationPayload(
        response.notification.request.content.data as Record<string, unknown> | undefined,
      ));
    });
    return () => subscription.remove();
  } catch (error) {
    onError?.('notifications.listener', error);
    return () => undefined;
  }
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
