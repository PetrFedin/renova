/** На web неактивные вкладки Tabs остаются в DOM — скрываем контент по активному pathname */
import type { ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import { usePathname } from 'expo-router';

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
  const pathname = usePathname();
  if (!segmentMatches(pathname, routeName)) return null;
  return <View style={s.root}>{children}</View>;
}

const s = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
});
