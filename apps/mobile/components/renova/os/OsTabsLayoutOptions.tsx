import type { ReactNode } from 'react';
import { Platform, View, StyleSheet, Pressable } from 'react-native';
import { useState } from 'react';
import { usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { tabBarScreenOptions } from '@/constants/tabBar';
import { OsSectionMenu } from '@/components/renova/os/OsSectionMenu';
import { OsProjectPicker } from '@/components/renova/os/OsProjectPicker';
import { OsAppHeader } from '@/components/renova/os/OsAppHeader';
import { OsHeaderBreadcrumb } from '@/components/renova/os/OsHeaderBreadcrumb';
import { OsDockBar } from '@/components/renova/os/OsDockBar';
import { pushOsTabNav } from '@/lib/osTabNav';
import { type OsRole } from '@/constants/osSections';
import { RenovaTheme } from '@/constants/Theme';
import { useRenova } from '@/lib/context/RenovaContext';
import { OsSearchModal } from '@/components/renova/os/OsSearchModal';
import { OsQuickFab } from '@/components/renova/os/OsQuickFab';
import { ApiStatusBanner } from '@/components/renova/ApiStatusBanner';
import { OsReturnBar } from '@/components/renova/os/OsReturnBar';
import { ActiveProjectSync } from '@/components/renova/ActiveProjectSync';

/** Шапка: лого + путь слева, меню разделов справа */
export function OsTabsHeaderBar({ role }: { role: OsRole }) {
  const pathname = usePathname();
  const { user, activeProject, apiReachable } = useRenova();
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <>
    <OsAppHeader
      left={<OsHeaderBreadcrumb role={role} />}
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
          <OsSectionMenu role={role} />
        </View>
      }
    />
    {activeProject && user && role === 'contractor' && (
      <OsSearchModal visible={searchOpen} onClose={() => setSearchOpen(false)} project={activeProject} userId={user.id} />
    )}
    </>
  );
}

export function useOsTabsScreenOptions(_role: OsRole) {
  return {
    ...tabBarScreenOptions,
    tabBar: () => null,
    tabBarStyle: { display: 'none' as const },
    headerShown: false,
    contentStyle: { paddingBottom: 0 },
  };
}

/** Оболочка вкладок: шапка + контент + нижняя панель */
export function OsTabsShell({ role, children }: { role: OsRole; children: ReactNode }) {
  return (
    <View style={shell.root}>
      <ActiveProjectSync />
      <OsTabsHeaderBar role={role} />
      <ApiStatusBanner showEmpty />
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
  body: { flex: 1, paddingBottom: Platform.OS === 'web' ? 4 : 0 },
});
