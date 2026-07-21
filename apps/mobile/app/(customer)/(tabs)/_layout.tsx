import { Tabs } from 'expo-router';
import { useOsTabsScreenOptions, OsTabsShell } from '@/components/renova/os/OsTabsLayoutOptions';

/** Renova OS — 4 столпа + сервисы; legacy tabs → [legacyTab] catch-all */
export default function CustomerTabs() {
  const screenOptions = useOsTabsScreenOptions('customer');
  return (
    <OsTabsShell role="customer">
      <Tabs initialRouteName="index" screenOptions={screenOptions}>
        <Tabs.Screen name="index" options={{ title: 'Главная' }} />
        <Tabs.Screen name="object" options={{ title: 'Объект' }} />
        <Tabs.Screen name="repair" options={{ title: 'Ремонт' }} />
        <Tabs.Screen name="budget" options={{ title: 'Деньги' }} />
        <Tabs.Screen name="chat" options={{ href: null }} />
        <Tabs.Screen name="profile" options={{ href: null }} />
        <Tabs.Screen name="calendar" options={{ href: null }} />
        <Tabs.Screen name="[legacyTab]" options={{ href: null }} />
      </Tabs>
    </OsTabsShell>
  );
}
