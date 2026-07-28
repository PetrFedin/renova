/**
 * Кастомный dock + Slot вместо expo-router <Tabs> (BottomTabNavigator).
 *
 * BottomTabNavigator в связке с expo-router useSortedScreens каждый рендер
 * пересоздаёт options → setOptions → Maximum update depth (особенно на web).
 * Нативный tab bar нам не нужен — OsDockBar уже SoT нижней навигации.
 */
import { memo } from 'react';
import { Platform, View, StyleSheet } from 'react-native';
import { Slot } from 'expo-router';
import { OsTabsHeaderBar } from '@/components/renova/os/OsTabsLayoutOptions';
import { OsDockBar } from '@/components/renova/os/OsDockBar';
import { ApiStatusBanner } from '@/components/renova/ApiStatusBanner';
import { StaleCacheBanner } from '@/components/renova/StaleCacheBanner';
import { ActiveProjectSync } from '@/components/renova/ActiveProjectSync';
import { OsQuickFab } from '@/components/renova/os/OsQuickFab';
import { OsPendingProjectPickEffect } from '@/components/renova/os/OsPendingProjectPickEffect';
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
