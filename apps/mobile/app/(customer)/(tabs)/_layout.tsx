import { OsRoleTabsNavigator } from '@/components/renova/os/OsRoleTabsNavigator';

/** Стартовая вкладка при первом заходе в группу (Slot, не BottomTabs). */
export const unstable_settings = {
  initialRouteName: 'index',
};

/**
 * Renova OS — 4 столпа + сервисы; legacy → [legacyTab].
 * Не используем expo-router <Tabs>: BottomTabNavigator + useSortedScreens на web
 * пересоздаёт options → setOptions → Maximum update depth. Dock — SoT нижней навигации.
 */
export default function CustomerTabs() {
  return <OsRoleTabsNavigator role="customer" />;
}
