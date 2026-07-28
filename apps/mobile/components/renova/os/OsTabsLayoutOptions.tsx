/**
 * Шапка OS (лого + поиск + профиль + picker + «Ещё»).
 * Раньше здесь жили OS_TABS_* / OsTabsShell под expo-router <Tabs> —
 * удалены после миграции на Slot (OsRoleTabsNavigator), чтобы не вернуть
 * Maximum update depth через BottomTabNavigator.
 */
import { View, StyleSheet, Pressable } from 'react-native';
import { useState } from 'react';
import { usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { OsSectionMenu } from '@/components/renova/os/OsSectionMenu';
import { OsProjectPicker } from '@/components/renova/os/OsProjectPicker';
import { OsAppHeader } from '@/components/renova/os/OsAppHeader';
import { OsHeaderLogo, OsPathBar } from '@/components/renova/os/OsHeaderBreadcrumb';
import { pushOsTabNav } from '@/lib/osTabNav';
import { type OsRole } from '@/constants/osSections';
import { RenovaTheme } from '@/constants/Theme';
import { useRenova } from '@/lib/context/RenovaContext';
import { OsSearchModal } from '@/components/renova/os/OsSearchModal';

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
            <OsSectionMenu role={role} />
          </View>
        }
      />
      {/* Под border шапки — путь по любому разделу роли/объекта */}
      <OsPathBar role={role} />
      {activeProject && user && role === 'contractor' && (
        <OsSearchModal
          visible={searchOpen}
          onClose={() => setSearchOpen(false)}
          project={activeProject}
          userId={user.id}
        />
      )}
    </>
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
