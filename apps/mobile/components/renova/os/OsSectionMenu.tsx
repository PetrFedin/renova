/** Панель «Ещё» в шапке — без дубля dock (столпы + чат уже внизу) */
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import {
  OS_MENU_SECTIONS,
  OS_MORE_UTIL_LINKS,
  MAX_HEADER_MORE_ITEMS,
  tabsRoute,
  type OsRole,
} from '@/constants/osSections';
import { TabIcon } from '@/components/renova/TabIcon';
import { useTopInset } from '@/lib/useTopInset';
import { useInboxTasks } from '@/lib/useChatUnread';

type Props = { role: OsRole; iconOnly?: boolean };

function MenuBadge({ count, tone = 'danger' }: { count: number; tone?: 'danger' | 'warning' }) {
  if (count <= 0) return null;
  return (
    <View style={[s.miniBadge, tone === 'warning' && s.miniBadgeWarn]}>
      <Text style={s.miniBadgeT}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

export function OsSectionMenu({ role, iconOnly = true }: Props) {
  const topInset = useTopInset();
  const menuRole: OsRole = role === 'contractor' ? 'contractor' : 'customer';
  const { taskBadge } = useInboxTasks(menuRole);
  const [open, setOpen] = useState(false);
  const pathname = usePathname() ?? '';
  const sections = OS_MENU_SECTIONS[menuRole];
  const utilLinks = OS_MORE_UTIL_LINKS;
  const seg = pathname.split('/').filter(Boolean).pop() || 'index';

  if (__DEV__ && sections.length + utilLinks.length > MAX_HEADER_MORE_ITEMS) {
    console.warn(
      `[IA] Header «Ещё» exceeds ${MAX_HEADER_MORE_ITEMS}: ${sections.length + utilLinks.length}`,
    );
  }

  /** Badge на иконке = задачи во входящих (чат — в dock) */
  const menuIconBadge = taskBadge;

  const go = (sec: (typeof sections)[0]) => {
    setOpen(false);
    router.replace(tabsRoute(menuRole, sec.routeName, sec.hubTab) as any);
  };

  return (
    <>
      <Pressable
        style={[s.btn, iconOnly && s.btnIcon]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={menuIconBadge > 0 ? `Ещё, ${menuIconBadge} входящих` : 'Ещё'}
        hitSlop={8}
      >
        <Ionicons name="ellipsis-horizontal-circle-outline" size={22} color={RenovaTheme.colors.text} />
        {menuIconBadge > 0 ? (
          <View style={s.badge}>
            <Text style={s.badgeT}>{menuIconBadge > 99 ? '99+' : menuIconBadge}</Text>
          </View>
        ) : null}
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setOpen(false)}>
          <View style={[s.menuWrap, { paddingTop: topInset + 56 }]} pointerEvents="box-none">
            <View style={s.menu}>
              <Text style={s.menuHead}>Ещё</Text>
              {sections.map((sec) => {
                const active = seg === sec.routeName;
                return (
                  <Pressable key={sec.id} style={[s.item, active && s.itemOn]} onPress={() => go(sec)}>
                    <TabIcon
                      name={sec.icon}
                      color={active ? RenovaTheme.colors.accent : RenovaTheme.colors.textMuted}
                      size={18}
                    />
                    <Text style={[s.itemT, active && s.itemTOn]}>{sec.label}</Text>
                    {active ? <Text style={s.check}>✓</Text> : null}
                  </Pressable>
                );
              })}
              <View style={s.divider} />
              {utilLinks.map((link) => (
                <Pressable
                  key={link.id}
                  style={s.item}
                  onPress={() => {
                    setOpen(false);
                    router.push({ pathname: link.href, params: { returnTo: pathname } } as any);
                  }}
                >
                  <Ionicons name={link.icon} size={18} color={RenovaTheme.colors.textMuted} />
                  <Text style={s.itemT}>{link.label}</Text>
                  {link.id === 'inbox' ? <MenuBadge count={taskBadge} tone="warning" /> : null}
                </Pressable>
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  btnIcon: {
    width: 40,
    height: 40,
    borderRadius: RenovaTheme.radius.sm,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surface,
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: RenovaTheme.colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeT: { color: RenovaTheme.colors.surface, fontSize: 9, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.35)' },
  menuWrap: { flex: 1, alignItems: 'flex-end', paddingRight: 12 },
  menu: {
    minWidth: 220,
    backgroundColor: RenovaTheme.colors.surface,
    borderRadius: RenovaTheme.radius.md,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
  },
  menuHead: {
    fontSize: 11,
    fontWeight: '700',
    color: RenovaTheme.colors.textMuted,
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  itemOn: { backgroundColor: RenovaTheme.colors.borderLight },
  itemT: { flex: 1, fontSize: 15, fontWeight: '600', color: RenovaTheme.colors.text },
  itemTOn: { color: RenovaTheme.colors.accent },
  check: { fontSize: 14, color: RenovaTheme.colors.accent, fontWeight: '700' },
  divider: { height: 1, backgroundColor: RenovaTheme.colors.border, marginVertical: 6, marginHorizontal: 12 },
  miniBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: RenovaTheme.colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  miniBadgeWarn: { backgroundColor: RenovaTheme.colors.warning },
  miniBadgeT: { color: RenovaTheme.colors.surface, fontSize: 10, fontWeight: '700' },
});
