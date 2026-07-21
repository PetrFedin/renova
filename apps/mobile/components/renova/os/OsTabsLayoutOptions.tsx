import type { ReactNode } from 'react';
import { Platform, View, StyleSheet, Pressable } from 'react-native';
import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { tabBarScreenOptions } from '@/constants/tabBar';
import { OsSectionMenu } from '@/components/renova/os/OsSectionMenu';
import { OsProjectPicker } from '@/components/renova/os/OsProjectPicker';
import { OsAppHeader } from '@/components/renova/os/OsAppHeader';
import { OsHeaderLogo, OsPathBar } from '@/components/renova/os/OsHeaderBreadcrumb';
import { OsDockBar } from '@/components/renova/os/OsDockBar';
import { pushOsTabNav } from '@/lib/osTabNav';
import { type OsRole } from '@/constants/osSections';
import { RenovaTheme } from '@/constants/Theme';
import { useRenova } from '@/lib/context/RenovaContext';
import { OsSearchModal } from '@/components/renova/os/OsSearchModal';
import { OsQuickFab } from '@/components/renova/os/OsQuickFab';
import { ApiStatusBanner } from '@/components/renova/ApiStatusBanner';
import { StaleCacheBanner } from '@/components/renova/StaleCacheBanner';
import { OsReturnBar } from '@/components/renova/os/OsReturnBar';
import { ActiveProjectSync } from '@/components/renova/ActiveProjectSync';
import { SESSION_KEYS } from '@/constants/sessionKeys';
import { projectPickRoute } from '@/lib/osEntry';
import { replaceOsNav } from '@/lib/pushOsNav';

/**
 * Стабильный screenOptions для expo-router Tabs.
 * Новый объект/`tabBar` на каждый рендер → Maximum update depth (React Navigation setState).
 */
const OS_TABS_SCREEN_OPTIONS = {
  ...tabBarScreenOptions,
  tabBar: () => null,
  tabBarStyle: { display: 'none' as const },
  headerShown: false,
  lazy: true,
  freezeOnBlur: true,
  detachInactiveScreens: true,
  sceneStyle: { flex: 1, overflow: 'hidden' as const },
  contentStyle: { paddingBottom: 0, flex: 1 },
};

/** Шапка: лого + иконки в ряду; путь — отдельный контейнер под линией */
export function OsTabsHeaderBar({ role }: { role: OsRole }) {
  const pathname = usePathname();
  const { user, activeProject, apiReachable } = useRenova();
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <>
    <OsAppHeader
      left={<OsHeaderLogo role={role} />}
      right={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {activeProject && user && role === 'contractor' && (
            <Pressable
              style={profileBtn.btn}
              onPress={() => setSearchOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={!apiReachable ? 'Поиск — сервер недоступен' : 'Поиск'}
              hitSlop={8}
            >
              <Ionicons name="search-outline" size={22} color={RenovaTheme.colors.text} />
              {!apiReachable ? <View style={profileBtn.offlineDot} /> : null}
            </Pressable>
          )}
          <Pressable
            style={profileBtn.btn}
            onPress={() => pushOsTabNav(role, 'profile', undefined, undefined, pathname)}
            accessibilityRole="button"
            accessibilityLabel="Профиль"
            hitSlop={8}
          >
            <Ionicons name="person-outline" size={22} color={RenovaTheme.colors.text} />
          </Pressable>
          <OsProjectPicker role={role} />
          {/* Сообщения только на dock — без дублирующей иконки в шапке */}
          <OsSectionMenu role={role} />
        </View>
      }
    />
    {/* Под border шапки — путь по любому разделу роли/объекта */}
    <OsPathBar role={role} />
    {activeProject && user && role === 'contractor' && (
      <OsSearchModal visible={searchOpen} onClose={() => setSearchOpen(false)} project={activeProject} userId={user.id} />
    )}
    </>
  );
}

export function useOsTabsScreenOptions(_role: OsRole) {
  return OS_TABS_SCREEN_OPTIONS;
}

/** Оболочка вкладок: шапка + контент + нижняя панель */
export function OsTabsShell({ role, children }: { role: OsRole; children: ReactNode }) {
  const pathname = usePathname();
  const { user, activeProject } = useRenova();
  const [pendingPick, setPendingPick] = useState(false);
  const pickNavLock = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(SESSION_KEYS.pendingProjectPick).then((v) => {
      const next = v === '1';
      setPendingPick((prev) => (prev === next ? prev : next));
    });
  }, [pathname, activeProject?.id, user?.id]);

  useEffect(() => {
    if (!user || activeProject || !pendingPick) {
      pickNavLock.current = false;
      return;
    }
    if (pathname.includes('/onboarding/')) return;
    if (pickNavLock.current) return;
    pickNavLock.current = true;
    replaceOsNav(projectPickRoute());
  }, [user?.id, activeProject?.id, pendingPick, pathname]);

  return (
    <View style={shell.root}>
      <ActiveProjectSync />
      <OsTabsHeaderBar role={role} />
      <ApiStatusBanner showEmpty />
      <StaleCacheBanner />
      <OsReturnBar role={role} />
      <View style={shell.body}>{children}</View>
      <OsQuickFab role={role} />
      <OsDockBar role={role} />
    </View>
  );
}

const profileBtn = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  offlineDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: RenovaTheme.colors.textMuted,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.surface,
  },
});

const shell = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8FAFC' },
  body: { flex: 1, minHeight: 0, paddingBottom: Platform.OS === 'web' ? 4 : 0, overflow: 'hidden' },
});
