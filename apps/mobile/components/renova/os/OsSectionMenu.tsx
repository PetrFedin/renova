/** Панель «Ещё» в шапке — без дубля dock (столпы + чат уже внизу) */
import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import {
  MAX_HEADER_MORE_ITEMS,
  tabsRoute,
  type OsRole,
} from '@/constants/osSections';
import { pushOsNav, replaceOsNav } from '@/lib/pushOsNav';
import { TabIcon } from '@/components/renova/TabIcon';
import { useTopInset } from '@/lib/useTopInset';
import { useInboxTasks } from '@/lib/useChatUnread';
import { moreMenuA11yLabel } from '@/lib/domain/moreMenuA11y';
import { resolveHeaderMoreBadge, resolveInboxMenuBadges } from '@/lib/domain/headerChatBadges';
import { useRenova } from '@/lib/context/RenovaContext';
import { getDockBar } from '@/lib/dockBarPrefs';
import { DOCK_DEFAULT, type DockItemId } from '@/constants/dockBar';
import { buildSecondaryNavigation, getRouteLabel } from '@/lib/navigation/navigationPolicy';

export { moreMenuA11yLabel };

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
  const { taskBadge, chatUnread } = useInboxTasks(menuRole);
  const [open, setOpen] = useState(false);
  const { user, readOnly } = useRenova();
  const [dockItems, setDockItems] = useState<DockItemId[]>(DOCK_DEFAULT);
  const pathname = usePathname() ?? '';
  useEffect(() => { void getDockBar(menuRole).then(setDockItems); }, [menuRole]);
  const links = buildSecondaryNavigation({
    role: menuRole,
    readOnly,
    guest: !user,
    dockItems,
    surface: 'header',
  });
  const sections = links.filter((route) => route.id === 'calendar');
  const utilLinks = links.filter((route) => route.id !== 'calendar');
  const seg = pathname.split('/').filter(Boolean).pop() || 'index';

  if (__DEV__ && sections.length + utilLinks.length > MAX_HEADER_MORE_ITEMS) {
    console.warn(
      `[IA] Header «Ещё» exceeds ${MAX_HEADER_MORE_ITEMS}: ${sections.length + utilLinks.length}`,
    );
  }

  /**
   * Непрочитанный чат: один SoT (inboxSyncStore) → «Ещё», «Входящие» и dock «Сообщения».
   * Задачи — янтарный бейдж рядом, без подмены числа сообщений.
   */
  const headerBadges = resolveHeaderMoreBadge(taskBadge, chatUnread);
  const inboxBadges = resolveInboxMenuBadges(taskBadge, chatUnread);

  const go = (sec: { routeName: string; hubTab?: string }) => {
    setOpen(false);
    replaceOsNav(tabsRoute(menuRole, sec.routeName, sec.hubTab), undefined, menuRole);
  };

  return (
    <>
      <Pressable
        style={[s.btn, iconOnly && s.btnIcon]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={moreMenuA11yLabel(taskBadge, chatUnread)}
        hitSlop={8}
      >
        <Ionicons name="menu-outline" size={22} color={RenovaTheme.colors.text} />
        <View style={s.headerBadges}>
          {headerBadges.map((badge) => (
            <View key={badge.kind} style={[s.badge, badge.tone === 'warning' ? s.badgeTasks : s.badgeChat]}>
              <Text style={s.badgeT}>{badge.count > 99 ? '99+' : badge.count}</Text>
            </View>
          ))}
        </View>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setOpen(false)}>
          <View style={[s.menuWrap, { paddingTop: topInset + 56 }]} pointerEvents="box-none">
            <View style={s.menu}>
              <Text style={s.menuHead}>Ещё</Text>
              {sections.map((sec) => {
                const active = seg === sec.id;
                return (
                  <Pressable key={sec.id} style={[s.item, active && s.itemOn]} onPress={() => go({ routeName: sec.id })}>
                    <TabIcon
                      name="calendar"
                      color={active ? RenovaTheme.colors.accent : RenovaTheme.colors.textMuted}
                      size={18}
                    />
                    <Text style={[s.itemT, active && s.itemTOn]}>{getRouteLabel(sec, menuRole)}</Text>
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
                    // W118: util links (inbox/docs/…) через SoT
                    pushOsNav(link.path, pathname, role);
                  }}
                >
                  <Ionicons name={link.id === 'inbox' ? 'mail-unread-outline' : link.id === 'approvals' ? 'checkmark-done-outline' : link.id === 'activity' ? 'time-outline' : 'document-text-outline'} size={18} color={RenovaTheme.colors.textMuted} />
                  <Text style={s.itemT}>{getRouteLabel(link, menuRole)}</Text>
                  {link.id === 'inbox' ? (
                    <View style={s.inboxBadges}>
                      {/* Красный = то же число, что на кнопке «Сообщения» внизу */}
                      <MenuBadge count={inboxBadges.chat} tone="danger" />
                      <MenuBadge count={inboxBadges.tasks} tone="warning" />
                    </View>
                  ) : null}
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
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  headerBadges: { position: 'absolute', top: 1, right: 1, flexDirection: 'row', gap: 2 },
  /** Янтарный = задачи; красный = непрочитанный чат (как dock «Сообщения») */
  badgeTasks: { backgroundColor: RenovaTheme.colors.warning },
  badgeChat: { backgroundColor: RenovaTheme.colors.danger },
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
  inboxBadges: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 'auto' },
  chatHint: {
    fontSize: 11,
    fontWeight: '600',
    color: RenovaTheme.colors.danger,
    marginLeft: 2,
  },
});
