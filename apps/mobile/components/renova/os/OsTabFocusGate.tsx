/** На web неактивные вкладки Tabs иногда остаются в DOM — скрываем по pathname (web) и фокусу (native) */
import type { ReactNode } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { usePathname } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';

function segmentMatches(pathname: string, routeName: string): boolean {
  const parts = pathname.split('/').filter(Boolean);
  const seg = parts[parts.length - 1] || 'index';
  if (routeName === 'index') return seg === 'index' || seg === '(tabs)';
  return seg === routeName;
}

export function OsTabFocusGate({
  children,
  routeName,
}: {
  children: ReactNode;
  routeName: string;
}) {
  const navFocused = useIsFocused();
  const pathname = usePathname();
  const pathMatch = segmentMatches(pathname, routeName);
  const visible = Platform.OS === 'web' ? pathMatch : navFocused && pathMatch;
  if (!visible) return null;
  return <View style={s.root}>{children}</View>;
}

const s = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
});
