/**
 * Шапка OS: лого слева в header-ряду.
 * Путь (Главная › …) — отдельный компактный контейнер под линией шапки.
 */
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { usePathname, useLocalSearchParams } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import { buildBreadcrumb, crumbHref, hubCrumbRoute } from '@/lib/breadcrumb';
import { tabsRoute, type OsRole } from '@/constants/osSections';
import { replaceOsNav } from '@/lib/pushOsNav';
import { OsRenovaLogo } from '@/components/renova/os/OsRenovaLogo';

function routeSegment(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last || last === '(tabs)') return 'index';
  return last;
}

function useOsCrumbs(role: OsRole) {
  const pathname = usePathname();
  const { tab, sub, filter } = useLocalSearchParams<{ tab?: string; sub?: string; filter?: string }>();
  const seg = routeSegment(pathname);
  const crumbs = buildBreadcrumb(role, pathname, {
    hubTab: typeof tab === 'string' ? tab : undefined,
    sub: typeof sub === 'string' ? sub : undefined,
    filter: typeof filter === 'string' ? filter : undefined,
  });
  return { pathname, tab, sub, filter, seg, crumbs };
}

function goCrumb(
  role: OsRole,
  routeName: string,
  ctx: { sub?: string; filter?: string },
) {
  // W120: крошки → replaceOsNav SoT
  if (routeName === 'index') {
    replaceOsNav(crumbHref(role, 'index'), undefined, role);
    return;
  }
  if (routeName.includes(':')) {
    replaceOsNav(hubCrumbRoute(role, routeName, ctx), undefined, role);
    return;
  }
  if (routeName === 'object' || routeName === 'repair' || routeName === 'budget') {
    replaceOsNav(tabsRoute(role, routeName), undefined, role);
    return;
  }
  replaceOsNav(crumbHref(role, routeName), undefined, role);
}

/** Только лого в верхнем ряду (между лого и иконками путь больше не рисуем). */
export function OsHeaderLogo({ role }: { role: OsRole }) {
  return (
    <View style={s.logoRow}>
      <OsRenovaLogo role={role} />
    </View>
  );
}

/**
 * Полоска пути под border шапки — любой раздел внутри роли/объекта.
 * На главной скрыта (путь избыточен).
 */
export function OsPathBar({ role }: { role: OsRole }) {
  const { seg, crumbs, sub, filter } = useOsCrumbs(role);
  if (seg === 'index' || crumbs.length === 0) return null;

  const ctx = {
    sub: typeof sub === 'string' ? sub : undefined,
    filter: typeof filter === 'string' ? filter : undefined,
  };

  return (
    <View style={s.pathWrap} accessibilityRole="header" accessibilityLabel="Путь навигации">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.pathIn}
      >
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <View key={`${c.routeName}-${i}`} style={s.segWrap}>
              {i > 0 ? <Text style={s.sep}>›</Text> : null}
              <Pressable
                onPress={() => goCrumb(role, c.routeName, ctx)}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityState={{ disabled: isLast }}
                disabled={isLast}
              >
                <Text style={isLast ? s.crumbOn : s.crumb} numberOfLines={1}>
                  {c.label}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** @deprecated Используйте OsHeaderLogo + OsPathBar */
export function OsHeaderBreadcrumb({ role }: { role: OsRole }) {
  return <OsHeaderLogo role={role} />;
}

const s = StyleSheet.create({
  logoRow: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  pathWrap: {
    marginHorizontal: 12,
    marginTop: 6,
    marginBottom: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: RenovaTheme.colors.surface,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
  },
  pathIn: { flexDirection: 'row', alignItems: 'center', paddingRight: 4 },
  segWrap: { flexDirection: 'row', alignItems: 'center', maxWidth: 160 },
  sep: { color: RenovaTheme.colors.textSubtle, marginHorizontal: 5, fontSize: 12 },
  crumb: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.textMuted },
  crumbOn: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.text },
});
