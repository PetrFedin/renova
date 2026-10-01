/** Страж группы маршрутов: нет сессии → вход, чужая роль → свой интерфейс. */
import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect, useGlobalSearchParams, usePathname } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import { tabsRoute } from '@/constants/osSections';
import { useRenova } from '@/lib/context/RenovaContext';
import { carryParams, decideRoleGroupAccess, sharedTabSegment, type RoleGroup } from '@/lib/roleGroupGuard';

export function RoleGroupGuard({ group, children }: { group: RoleGroup; children: ReactNode }) {
  const { loading, user } = useRenova();
  const pathname = usePathname();
  const search = useGlobalSearchParams();
  const decision = decideRoleGroupAccess(group, { loading, hasUser: !!user, userRole: user?.role });
  if (decision.kind === 'wait') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: RenovaTheme.colors.background }}>
        <ActivityIndicator color={RenovaTheme.colors.primary} size="large" />
      </View>
    );
  }
  if (decision.kind === 'login') return <Redirect href="/onboarding/role" />;
  if (decision.kind === 'redirect') {
    // Та же вкладка и те же параметры в своей группе (а не всегда главная).
    const seg = sharedTabSegment(pathname);
    const extra = seg === 'index' ? undefined : carryParams(search);
    return <Redirect href={tabsRoute(decision.to, seg, undefined, extra) as never} />;
  }
  return <>{children}</>;
}
