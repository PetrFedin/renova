/** Страж группы маршрутов: нет сессии → вход, чужая роль → свой интерфейс. */
import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import { tabsRoute } from '@/constants/osSections';
import { useRenova } from '@/lib/context/RenovaContext';
import { decideRoleGroupAccess, type RoleGroup } from '@/lib/roleGroupGuard';

export function RoleGroupGuard({ group, children }: { group: RoleGroup; children: ReactNode }) {
  const { loading, user } = useRenova();
  const decision = decideRoleGroupAccess(group, { loading, hasUser: !!user, userRole: user?.role });
  if (decision.kind === 'wait') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: RenovaTheme.colors.background }}>
        <ActivityIndicator color={RenovaTheme.colors.primary} size="large" />
      </View>
    );
  }
  if (decision.kind === 'login') return <Redirect href="/onboarding/role" />;
  if (decision.kind === 'redirect') return <Redirect href={tabsRoute(decision.to, 'index') as never} />;
  return <>{children}</>;
}
