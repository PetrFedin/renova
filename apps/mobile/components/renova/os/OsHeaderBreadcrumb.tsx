/** Слева: лого RENOVA + путь с «Главная» для возврата на index */
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { router, usePathname, useLocalSearchParams } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import { buildBreadcrumb, crumbHref, hubCrumbRoute } from '@/lib/breadcrumb';
import { tabsRoute, type OsRole } from '@/constants/osSections';
import { OsRenovaLogo } from '@/components/renova/os/OsRenovaLogo';

function routeSegment(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last || last === '(tabs)') return 'index';
  return last;
}

export function OsHeaderBreadcrumb({ role }: { role: OsRole }) {
  const pathname = usePathname();
  const { tab, sub, filter } = useLocalSearchParams<{ tab?: string; sub?: string; filter?: string }>();
  const seg = routeSegment(pathname);
  const crumbs = buildBreadcrumb(role, pathname, {
    hubTab: typeof tab === 'string' ? tab : undefined,
    sub: typeof sub === 'string' ? sub : undefined,
    filter: typeof filter === 'string' ? filter : undefined,
  });
  const displayCrumbs = seg === 'index' ? [] : crumbs;

  const go = (routeName: string) => {
    if (routeName === 'index') {
      router.replace(crumbHref(role, 'index') as any);
      return;
    }
    if (routeName.includes(':')) {
      router.replace(hubCrumbRoute(role, routeName, { sub: typeof sub === 'string' ? sub : undefined, filter: typeof filter === 'string' ? filter : undefined }) as any);
      return;
    }
    if (routeName === 'object' || routeName === 'repair' || routeName === 'budget') {
      router.replace(tabsRoute(role, routeName) as any);
      return;
    }
    router.replace(crumbHref(role, routeName) as any);
  };

  return (
    <View style={s.row}>
      <OsRenovaLogo role={role} />
      {displayCrumbs.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.trail} contentContainerStyle={s.trailIn}>
          {displayCrumbs.map((c, i) => (
            <View key={`${c.routeName}-${i}`} style={s.segWrap}>
              {i > 0 ? <Text style={s.sep}>›</Text> : <Text style={s.sep}>›</Text>}
              <Pressable onPress={() => go(c.routeName)} hitSlop={4} accessibilityRole="button">
                <Text
                  style={i === displayCrumbs.length - 1 ? s.crumbOn : s.crumb}
                  numberOfLines={1}
                >
                  {c.label}
                </Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 },
  trail: { flex: 1, minWidth: 0 },
  trailIn: { flexDirection: 'row', alignItems: 'center', paddingRight: 4 },
  segWrap: { flexDirection: 'row', alignItems: 'center', maxWidth: 140 },
  sep: { color: RenovaTheme.colors.textSubtle, marginHorizontal: 4, fontSize: 14 },
  crumb: { fontSize: 13, fontWeight: '600', color: RenovaTheme.colors.textMuted },
  crumbOn: { fontSize: 13, fontWeight: '700', color: RenovaTheme.colors.text },
});
