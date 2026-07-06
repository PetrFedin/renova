import { Tabs } from 'expo-router';
import { useOsTabsScreenOptions, OsTabsShell } from '@/components/renova/os/OsTabsLayoutOptions';

/** Renova OS — 4 раздела + сервисные скрытые маршруты */
export default function CustomerTabs() {
  const screenOptions = useOsTabsScreenOptions('customer');
  return (
    <OsTabsShell role="customer">
    <Tabs initialRouteName="index" screenOptions={screenOptions}>
      <Tabs.Screen name="index" options={{ title: 'Главная' }} />
      <Tabs.Screen name="object" options={{ title: 'Объект' }} />
      <Tabs.Screen name="repair" options={{ title: 'Ремонт' }} />
      <Tabs.Screen name="budget" options={{ title: 'Бюджет' }} />
      <Tabs.Screen name="works" options={{ href: null }} />
      <Tabs.Screen name="materials" options={{ href: null }} />
      <Tabs.Screen name="control" options={{ href: null }} />
      <Tabs.Screen name="more" options={{ href: null }} />
      <Tabs.Screen name="stages" options={{ href: null }} />
      <Tabs.Screen name="finance" options={{ href: null }} />
      <Tabs.Screen name="estimate" options={{ href: null }} />
      <Tabs.Screen name="chat" options={{ href: null }} />
      <Tabs.Screen name="profile" options={{ href: null }} />
      <Tabs.Screen name="rooms" options={{ href: null }} />
      <Tabs.Screen name="calendar" options={{ href: null }} />
      <Tabs.Screen name="guide" options={{ href: null }} />
      <Tabs.Screen name="plan" options={{ href: null }} />
    </Tabs>
    </OsTabsShell>
  );
}
