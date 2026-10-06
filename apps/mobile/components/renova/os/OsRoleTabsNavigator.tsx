/**
 * Кастомный dock + Slot вместо expo-router <Tabs> (BottomTabNavigator).
 *
 * BottomTabNavigator в связке с expo-router useSortedScreens каждый рендер
 * пересоздаёт options → setOptions → Maximum update depth (особенно на web).
 * Нативный tab bar нам не нужен — OsDockBar уже SoT нижней навигации.
 */
import { memo } from 'react';
import { Platform, View, StyleSheet, useWindowDimensions } from 'react-native';
import { Slot } from 'expo-router';
import { OsTabsHeaderBar } from '@/components/renova/os/OsTabsLayoutOptions';
import { OsDockBar } from '@/components/renova/os/OsDockBar';
import { DataStatusBanner } from '@/components/renova/DataStatusBanner';
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
      <DataStatusBanner showEmpty />
    </View>
  );
}

function OsRoleTabsNavigatorImpl({ role }: Props) {
  const { width } = useWindowDimensions();
  // Wide web gets its persistent left rail from WideScreenFrame; phone keeps the bottom dock here.
  const wideShell = Platform.OS === 'web' && width >= 768;

  return (
    <View style={shell.root}>
      <ActiveProjectSync />
      <OsPendingProjectPickEffect />
      <OsTabsChromeHeader role={role} />
      <View style={shell.main}>
        <View style={shell.body}>
          {/* Текущий экран из app/(role)/(tabs)/* — без BottomTabNavigator */}
          <Slot />
        </View>
      </View>
      <OsQuickFab role={role} />
      {!wideShell ? <OsDockBar role={role} /> : null}
    </View>
  );
}

export const OsRoleTabsNavigator = memo(OsRoleTabsNavigatorImpl);

const shell = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8FAFC' },
  main: { flex: 1, minHeight: 0 },
  body: { flex: 1, minHeight: 0, paddingBottom: Platform.OS === 'web' ? 4 : 0, overflow: 'hidden' },
});
