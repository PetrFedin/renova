/**
 * Кастомный dock + Slot вместо expo-router <Tabs> (BottomTabNavigator).
 *
 * BottomTabNavigator в связке с expo-router useSortedScreens каждый рендер
 * пересоздаёт options → setOptions → Maximum update depth (особенно на web).
 * Нативный tab bar нам не нужен — OsDockBar уже SoT нижней навигации.
 */
import { memo, useEffect } from 'react';
import { Platform, View, StyleSheet } from 'react-native';
import { Redirect, Slot, router, usePathname, useGlobalSearchParams } from 'expo-router';
import { OsTabsHeaderBar } from '@/components/renova/os/OsTabsLayoutOptions';
import { OsDockBar } from '@/components/renova/os/OsDockBar';
import { ApiStatusBanner } from '@/components/renova/ApiStatusBanner';
import { StaleCacheBanner } from '@/components/renova/StaleCacheBanner';
import { ActiveProjectSync } from '@/components/renova/ActiveProjectSync';
import { OsQuickFab } from '@/components/renova/os/OsQuickFab';
import { OsPendingProjectPickEffect } from '@/components/renova/os/OsPendingProjectPickEffect';
import { useRenova } from '@/lib/context/RenovaContext';
import {
  roleGroupRedirectPath,
  roleGroupRootRedirectPath,
  signedOutRedirectPath,
} from '@/lib/domain/roleGroupRedirect';
import type { OsRole } from '@/constants/osSections';

type Props = { role: OsRole };

function OsTabsChromeHeader({ role }: { role: OsRole }) {
  return (
    <View>
      {/* OsTabsHeaderBar уже рисует единый OsPathBar (Назад + крошки) */}
      <OsTabsHeaderBar role={role} />
      <ApiStatusBanner showEmpty />
      <StaleCacheBanner />
    </View>
  );
}

function OsRoleTabsNavigatorImpl({ role }: Props) {
  const { user, loading } = useRenova();
  const pathname = usePathname();
  // Именно global: параметры нужны от открытого экрана, а не от самого макета —
  // иначе `?tab=profile` терялся бы при переносе в свою группу.
  const params = useGlobalSearchParams<Record<string, string>>();

  // Адреса у групп `(customer)` и `(contractor)` одинаковые: по прямой ссылке
  // роутер выбирает группу сам, и человек попадает на экран чужой роли —
  // вместе с чужими правами. Внутренние переходы идут с явным префиксом и
  // сюда не попадают.
  // Без сессии этот макет вообще не должен рисоваться: `app/index.tsx` уводит
  // на вход, но до него дело не доходит — адрес `/` достаётся групповому
  // экрану. Человек без аккаунта видел главную заказчика с «Нет данных
  // проекта» и не мог с неё ни войти, ни зарегистрироваться.
  const signedOutTo = signedOutRedirectPath(user?.role, loading);
  const redirectTo = loading ? null : roleGroupRedirectPath(role, user?.role, pathname);
  // Корень `/` отдаётся обеим группам, и роутер выбирает чужую. Переносим уже
  // после монтирования: в первом кадре путь ещё не установился, и редирект
  // унёс бы с адреса, на который вела ссылка.
  const rootRedirectTo = loading ? null : roleGroupRootRedirectPath(role, user?.role, pathname);
  useEffect(() => {
    if (!rootRedirectTo) return;
    router.replace(rootRedirectTo as never);
  }, [rootRedirectTo]);

  if (signedOutTo) return <Redirect href={signedOutTo as never} />;

  if (redirectTo) {
    const carried = Object.fromEntries(
      Object.entries(params).filter(([, value]) => typeof value === 'string'),
    ) as Record<string, string>;
    return <Redirect href={{ pathname: redirectTo, params: carried }} />;
  }

  return (
    <View style={shell.root}>
      <ActiveProjectSync />
      <OsPendingProjectPickEffect />
      <OsTabsChromeHeader role={role} />
      <View style={shell.body}>
        {/* Текущий экран из app/(role)/(tabs)/* — без BottomTabNavigator */}
        <Slot />
      </View>
      <OsQuickFab role={role} />
      <OsDockBar role={role} />
    </View>
  );
}

export const OsRoleTabsNavigator = memo(OsRoleTabsNavigatorImpl);

const shell = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8FAFC' },
  body: { flex: 1, minHeight: 0, paddingBottom: Platform.OS === 'web' ? 4 : 0, overflow: 'hidden' },
});
