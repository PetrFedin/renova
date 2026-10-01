/** Уведомления — лента in-app уведомлений пользователя */
import { useLocalSearchParams } from 'expo-router';
import { NotificationsScreen } from '@/components/screens/NotificationsScreen';

export default function NotificationCenterRoute() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  return <NotificationsScreen returnTo={returnTo} />;
}
