/** Страж аудитории маршрута (O-1): чужая роль → свой интерфейс + короткое уведомление, без запросов в сеть. */
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect, useGlobalSearchParams } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import { repairTabRoute, tabsRoute } from '@/constants/osSections';
import { useRenova } from '@/lib/context/RenovaContext';
import { notifyInfo } from '@/lib/notify';
import { carryParams } from '@/lib/roleGroupGuard';
import { decideRouteAudienceAccess } from '@/lib/routeAudienceGuard';

export function RouteAudienceGuard({ path, children }: { path: string; children: ReactNode }) {
  const { loading, user } = useRenova();
  const search = useGlobalSearchParams();
  const decision = decideRouteAudienceAccess(path, { loading, hasUser: !!user, userRole: user?.role });
  const notified = useRef(false);
  const denied = decision.kind === 'redirect';
  const message = denied ? decision.message : '';
  useEffect(() => {
    if (denied && !notified.current) {
      notified.current = true;
      notifyInfo('Раздел недоступен', message);
    }
  }, [denied, message]);

  if (decision.kind === 'wait') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: RenovaTheme.colors.background }}>
        <ActivityIndicator color={RenovaTheme.colors.primary} size="large" />
      </View>
    );
  }
  if (decision.kind === 'redirect') {
    if (decision.to === 'repair-control') {
      const t = repairTabRoute('customer', 'control');
      return <Redirect href={{ pathname: t.pathname, params: { ...carryParams(search), ...(t.params || {}) } } as never} />;
    }
    return <Redirect href={tabsRoute('customer', 'index') as never} />;
  }
  return <>{children}</>;
}

/** Обёртка экрана: `guardedScreen('/conflicts', Screen)`. */
export function guardedScreen(path: string, Screen: React.ComponentType): React.ComponentType {
  return function GuardedScreen() {
    return (
      <RouteAudienceGuard path={path}>
        <Screen />
      </RouteAudienceGuard>
    );
  };
}
