/** Уведомления в профиле — одна лента без дубля «группы + список». */
import { NotificationCenter } from '@/components/renova/NotificationCenter';

export function ProfileNotifications({ userId }: { userId: string }) {
  return <NotificationCenter userId={userId} compact hideHeader />;
}
