import { OsRoleTabsNavigator } from '@/components/renova/os/OsRoleTabsNavigator';

export const unstable_settings = {
  initialRouteName: 'index',
};

/**
 * Renova OS — 4 столпа + сервисы; legacy → [legacyTab].
 * Slot вместо <Tabs>: на web BottomTabNavigator даёт Maximum update depth.
 */
export default function ContractorTabs() {
  return <OsRoleTabsNavigator role="contractor" />;
}
