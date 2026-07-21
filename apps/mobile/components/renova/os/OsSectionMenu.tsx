/** Панель «Ещё» в шапке — без дубля dock (столпы + чат уже внизу) */
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import {
  OS_MENU_SECTIONS,
  OS_MORE_UTIL_LINKS,
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
  const pathname = usePathname() ?? '';
  const sections = OS_MENU_SECTIONS[menuRole];
  const utilLinks = OS_MORE_UTIL_LINKS;
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
  const headerBadge = resolveHeaderMoreBadge(taskBadge, chatUnread);
  const inboxBadges = resolveInboxMenuBadges(taskBadge, chatUnread);

  const go = (sec: (typeof sections)[0]) => {
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
        {headerBadge ? (
          <View style={[s.badge, headerBadge.tone === 'warning' ? s.badgeTasks : s.badgeChat]}>
            <Text style={s.badgeT}>{headerBadge.count > 99 ? '99+' : headerBadge.count}</Text>
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
                    // W118: util links (inbox/docs/…) через SoT
                    pushOsNav(link.href, pathname, role);
                  }}
                >
                  <Ionicons name={link.icon} size={18} color={RenovaTheme.colors.textMuted} />
                  <Text style={s.itemT}>{link.label}</Text>
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
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
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
