/**
 * Шапка OS: лого слева.
 * Единая полоска пути: «← Назад · Главная · Данные объекта»
 * (returnTo + крошки в одном ряду — без второго бара).
 */
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { usePathname, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { RenovaTheme } from '@/constants/Theme';
import { buildBreadcrumb, crumbHref, hubCrumbRoute } from '@/lib/breadcrumb';
import { tabsRoute, type OsRole } from '@/constants/osSections';
import { replaceOsNav } from '@/lib/pushOsNav';
import { goBack } from '@/lib/navigation';
import { returnToLabel } from '@/lib/osReturnTo';
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
  return { tab, sub, filter, seg, crumbs };
}

function goCrumb(
  role: OsRole,
  routeName: string,
  ctx: { sub?: string; filter?: string },
) {
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

/** Только лого в верхнем ряду. */
export function OsHeaderLogo({ role }: { role: OsRole }) {
  return (
    <View style={s.logoRow}>
      <OsRenovaLogo role={role} />
    </View>
  );
}

/**
 * Один путь под шапкой.
 * С returnTo: ← Назад · Главная · …
 * Без returnTo (dock): Главная · …
 */
export function OsPathBar({ role }: { role: OsRole }) {
  const { seg, crumbs, sub, filter } = useOsCrumbs(role);
  const { returnTo } = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const rt = Array.isArray(returnTo) ? returnTo[0] : returnTo;

  const onHome = seg === 'index';
  // На главной без returnTo полоска не нужна
  if (onHome && !rt) return null;
  // Нечего показать
  if (!rt && (crumbs.length === 0 || (crumbs.length === 1 && crumbs[0].routeName === 'index'))) {
    return null;
  }

  const ctx = {
    sub: typeof sub === 'string' ? sub : undefined,
    filter: typeof filter === 'string' ? filter : undefined,
  };

  const fromLabel = rt ? returnToLabel(rt, role) : undefined;
  const backA11y = fromLabel ? `Назад к «${fromLabel}»` : 'Назад';

  // На главной с returnTo — только кнопка назад (крошка «Главная» избыточна)
  const showCrumbs = !onHome && crumbs.length > 0;

  const a11yParts: string[] = [];
  if (rt) a11yParts.push(backA11y);
  if (showCrumbs) a11yParts.push(...crumbs.map((c) => c.label));

  return (
    <View
      style={[s.pathWrap, rt ? s.pathWrapBack : null]}
      accessibilityRole="header"
      accessibilityLabel={`Путь: ${a11yParts.join(' · ')}`}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.pathIn}
      >
        {rt ? (
          <Pressable
            onPress={() => goBack(rt, role)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={backA11y}
            style={s.backBtn}
          >
            <Ionicons name="chevron-back" size={16} color={RenovaTheme.colors.primary} />
            <Text style={s.backText} numberOfLines={1}>
              Назад{fromLabel && fromLabel !== 'Главная' ? ` · ${fromLabel}` : ''}
            </Text>
          </Pressable>
        ) : null}

        {showCrumbs
          ? crumbs.map((c, i) => {
              const isLast = i === crumbs.length - 1;
              const showSep = Boolean(rt) || i > 0;
              return (
                <View key={`${c.routeName}-${i}`} style={s.segWrap}>
                  {showSep ? <Text style={s.sep}>·</Text> : null}
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
            })
          : null}
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
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: RenovaTheme.colors.surface,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
  },
  pathWrapBack: {
    backgroundColor: RenovaTheme.colors.infoBg,
    borderColor: '#BFDBFE',
  },
  pathIn: { flexDirection: 'row', alignItems: 'center', paddingRight: 4 },
  segWrap: { flexDirection: 'row', alignItems: 'center', maxWidth: 160 },
  sep: {
    color: RenovaTheme.colors.textSubtle,
    marginHorizontal: 6,
    fontSize: 12,
    fontWeight: '600',
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, maxWidth: 160 },
  backText: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.primary },
  crumb: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.textMuted },
  crumbOn: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.text },
});
