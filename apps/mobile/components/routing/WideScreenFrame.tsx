/**
 * Responsive web application shell.
 * Phone keeps the native/mobile structure. Tablet and desktop keep a persistent,
 * collapsible left navigation rail across both hub tabs and detail routes.
 */
import type { ReactNode } from 'react';
import { Platform, View, useWindowDimensions } from 'react-native';
import { usePathname } from 'expo-router';

import { RenovaTheme } from '@/constants/Theme';
import { MAX_CONTENT_WIDTH } from '@/constants/layout';
import { OsDockBar } from '@/components/renova/os/OsDockBar';
import { useRenova } from '@/lib/context/RenovaContext';
import type { OsRole } from '@/constants/osSections';

function isSetupRoute(pathname: string) {
  return pathname.startsWith('/onboarding') || pathname.startsWith('/wizard');
}

export function WideScreenFrame({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  const pathname = usePathname();
  const { user } = useRenova();

  if (Platform.OS !== 'web') return <>{children}</>;

  const wide = width >= 768;
  const showRail = wide && Boolean(user) && !isSetupRoute(pathname);
  const role: OsRole = user?.role === 'contractor' ? 'contractor' : 'customer';

  return (
    <View style={{ flex: 1, alignItems: 'center', backgroundColor: RenovaTheme.colors.background }}>
      <View
        style={{
          flex: 1,
          width: '100%',
          maxWidth: MAX_CONTENT_WIDTH,
          flexDirection: showRail ? 'row' : 'column',
          minHeight: 0,
        }}
      >
        {showRail ? <OsDockBar role={role} orientation="side" /> : null}
        <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>{children}</View>
      </View>
    </View>
  );
}
