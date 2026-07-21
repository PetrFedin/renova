import { Redirect, type Href } from 'expo-router';
import type { OsTabRoute } from '@/constants/osSections';
import { ActivityIndicator, View } from 'react-native';
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RenovaTheme } from '@/constants/Theme';
import { useRenova } from '@/lib/context/RenovaContext';
import { osEntryRoute, projectPickRoute } from '@/lib/osEntry';
import { SESSION_KEYS } from '@/constants/sessionKeys';


export default function Index() {
  const { loading, user } = useRenova();
  const [href, setHref] = useState<string | OsTabRoute | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setHref('/onboarding/role');
      return;
    }
    AsyncStorage.getItem(SESSION_KEYS.pendingProjectPick).then((pending) => {
      if (pending === '1') {
        setHref(projectPickRoute());
        return;
      }
      setHref(osEntryRoute(user.role === 'contractor' ? 'contractor' : 'customer'));
    });
  }, [loading, user?.id, user?.role]);

  if (loading || !href) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: RenovaTheme.colors.background }}>
        <ActivityIndicator color={RenovaTheme.colors.primary} size="large" />
      </View>
    );
  }

  if (!user) return <Redirect href="/onboarding/role" />;

  return <Redirect href={href as Href} />;
}
