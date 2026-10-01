/** Экран «Уведомления» — лента in-app уведомлений (колокольчик в шапке). */
import { ScrollView, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { BackHeader } from '@/components/renova/BackHeader';
import { NotificationCenter } from '@/components/renova/NotificationCenter';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { useRenova } from '@/lib/context/RenovaContext';
import type { OsRole } from '@/constants/osSections';

export function NotificationsScreen({ returnTo }: { returnTo?: string }) {
  const { user } = useRenova();
  const role: OsRole = user?.role === 'contractor' ? 'contractor' : 'customer';

  if (!user) {
    return (
      <>
        <BackHeader title="Уведомления" returnTo={returnTo} />
        <ProjectEmptyState role={role} />
      </>
    );
  }

  return (
    <>
      <BackHeader title="Уведомления" returnTo={returnTo} />
      <ScrollView style={s.wrap} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <NotificationCenter userId={user.id} role={role} />
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({ wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background } });
