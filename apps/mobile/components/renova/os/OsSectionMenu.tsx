/** Панель разделов OS — иконка справа в шапке + сервисные ссылки */
import { useState, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, usePathname, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import { OS_MENU_SECTIONS, resolveSectionId, tabsRoute, type OsRole } from '@/constants/osSections';
import { TabIcon } from '@/components/renova/TabIcon';
import { useTopInset } from '@/lib/useTopInset';
import { useRenova } from '@/lib/context/RenovaContext';
import { useChatUnread, useInboxWsListener } from '@/lib/useChatUnread';
import { buildInboxItems, inboxMenuBadge } from '@/lib/domain/buildInboxItems';

/** Без дубля «Сообщений» — «Входящие» отдельной строкой */
const UTIL_LINKS: { id: string; label: string; href: string; icon: 'time-outline' | 'document-text-outline' | 'mail-unread-outline' }[] = [
  { id: 'inbox', label: 'Входящие', href: '/inbox', icon: 'mail-unread-outline' },
  { id: 'activity', label: 'Архив ремонта', href: '/activity', icon: 'time-outline' },
  { id: 'documents', label: 'Документы', href: '/documents', icon: 'document-text-outline' },
];

type Props = { role: OsRole; iconOnly?: boolean };

export function OsSectionMenu({ role, iconOnly = true }: Props) {
  const topInset = useTopInset();
  const { user, activeProject } = useRenova();
  const { count: chatUnread } = useChatUnread(user?.id);
  const [open, setOpen] = useState(false);
  const [inboxCount, setInboxCount] = useState(0);
  const pathname = usePathname();
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const sections = OS_MENU_SECTIONS[role];
  const currentId = resolveSectionId(pathname);
  const seg = pathname.split('/').filter(Boolean).pop() || 'index';

  const reloadInbox = useCallback(async () => {
    if (!user || !activeProject) { setInboxCount(0); return; }
    const items = await buildInboxItems({
      userId: user.id,
      projectId: activeProject.id,
      role,
      chatUnread,
      project: activeProject,
    });
    setInboxCount(inboxMenuBadge(items));
  }, [user?.id, activeProject, role, chatUnread]);

  useFocusEffect(useCallback(() => { reloadInbox().catch(() => {}); }, [reloadInbox]));
  useInboxWsListener(useCallback(() => { reloadInbox().catch(() => {}); }, [reloadInbox]));

  const totalBadge = inboxCount;

  const isActive = (sec: (typeof sections)[0]) => {
    if (sec.id === 'chat') return seg === 'chat';
    if (sec.id === 'calendar') return seg === 'calendar';
    if (sec.id === 'repair') return seg === 'repair';
    return sec.id === currentId;
  };

  const go = (sec: (typeof sections)[0]) => {
    setOpen(false);
    router.replace(tabsRoute(role, sec.routeName, sec.hubTab) as any);
  };

  return (
    <>
      <Pressable
        style={[s.btn, iconOnly && s.btnIcon]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Разделы проекта"
        hitSlop={8}
      >
        <Ionicons
          name="grid-outline"
          size={22}
          color={RenovaTheme.colors.text}
        />
        {totalBadge > 0 ? (
          <View style={s.badge}><Text style={s.badgeT}>{totalBadge > 99 ? '99+' : totalBadge}</Text></View>
        ) : null}
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setOpen(false)}>
          <View style={[s.menuWrap, { paddingTop: topInset + 56 }]} pointerEvents="box-none">
            <View style={s.menu}>
              <Text style={s.menuHead}>Разделы</Text>
              {sections.map((sec) => {
                const active = isActive(sec);
                return (
                  <Pressable key={sec.id} style={[s.item, active && s.itemOn]} onPress={() => go(sec)}>
                    <TabIcon name={sec.icon} color={active ? RenovaTheme.colors.accent : RenovaTheme.colors.textMuted} size={18} />
                    <Text style={[s.itemT, active && s.itemTOn]}>{sec.label}</Text>
                    {active ? <Text style={s.check}>✓</Text> : null}
                  </Pressable>
                );
              })}
              <View style={s.divider} />
              {UTIL_LINKS.map((link) => (
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
                  {link.id === 'inbox' && inboxCount > 0 ? (
                    <View style={s.miniBadge}><Text style={s.miniBadgeT}>{inboxCount > 99 ? '99+' : inboxCount}</Text></View>
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
    position: 'absolute', top: 2, right: 2, minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: RenovaTheme.colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
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
  miniBadge: { minWidth: 18, height: 18, borderRadius: 9, backgroundColor: RenovaTheme.colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  miniBadgeT: { color: RenovaTheme.colors.surface, fontSize: 10, fontWeight: '700' },
});
