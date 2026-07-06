/** Нижняя панель — 5 настраиваемых кнопок */
import { useCallback, useState, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router, usePathname, useFocusEffect } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import { TabIcon } from '@/components/renova/TabIcon';
import { ChatBadge } from '@/components/renova/chat/ChatBadge';
import { DOCK_BY_ID, type DockItemId } from '@/constants/dockBar';
import { getDockBar, subscribeDockBar } from '@/lib/dockBarPrefs';
import { resolveSectionId, tabsRoute, type OsRole } from '@/constants/osSections';
import { useBottomInset } from '@/lib/useTopInset';
import { useRenova } from '@/lib/context/RenovaContext';
import { useChatUnread } from '@/lib/useChatUnread';

const REPAIR_SEGMENTS = new Set(['repair', 'works', 'materials', 'control', 'stages']);
const OBJECT_SEGMENTS = new Set(['object', 'rooms', 'estimate', 'plan']);

export function OsDockBar({ role }: { role: OsRole }) {
  const pathname = usePathname();
  const bottomPad = useBottomInset();
  const { user } = useRenova();
  const { count: chatUnread } = useChatUnread(user?.id);
  const [items, setItems] = useState<DockItemId[]>(['home', 'chat', 'object', 'repair', 'budget']);
  const section = resolveSectionId(pathname);
  const seg = pathname.split('/').filter(Boolean).pop() || 'index';

  const reload = useCallback(() => {
    getDockBar(role).then(setItems).catch(() => {});
  }, [role]);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  useEffect(() => subscribeDockBar(reload), [reload]);

  const isActive = (id: DockItemId) => {
    const item = DOCK_BY_ID[id];
    if (!item) return false;
    if (item.routeName === 'index') return seg === 'index' || seg === '(tabs)' || section === 'home';
    if (id === 'object') return OBJECT_SEGMENTS.has(seg) || section === 'object';
    if (id === 'calendar') return seg === 'calendar';
    if (id === 'repair') return seg === 'repair' || REPAIR_SEGMENTS.has(seg);
    if (id === 'budget') return seg === 'budget' || seg === 'finance' || seg === 'money' || section === 'budget';
    if (id === 'chat') return seg === 'chat';
    return seg === item.routeName || item.id === section;
  };

  const go = (id: DockItemId) => {
    const item = DOCK_BY_ID[id];
    if (!item) return;
    router.navigate(tabsRoute(role, item.routeName, item.hubTab) as any);
  };

  return (
    <View style={[s.bar, { paddingBottom: bottomPad }]}>
      {items.map((id) => {
        const item = DOCK_BY_ID[id];
        if (!item) return null;
        const active = isActive(id);
        const color = active ? RenovaTheme.colors.tabActive : RenovaTheme.colors.tabInactive;
        return (
          <Pressable
            key={id}
            style={({ pressed }) => [s.tab, pressed && s.pressed]}
            onPress={() => go(id)}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityState={active ? { selected: true } : {}}
          >
            <View style={s.iconWrap}>
              <TabIcon name={item.icon} color={color} size={22} />
              {id === 'chat' && <ChatBadge count={chatUnread} />}
            </View>
            <Text style={[s.label, active && s.labelOn]} numberOfLines={1}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    paddingTop: 8,
    minHeight: 56,
    backgroundColor: RenovaTheme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: RenovaTheme.colors.border,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
    paddingHorizontal: 2,
    paddingVertical: 4,
  },
  pressed: { opacity: 0.65 },
  iconWrap: { position: 'relative', width: 28, height: 24, alignItems: 'center', justifyContent: 'center' },
  label: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 3,
    lineHeight: 12,
    color: RenovaTheme.colors.tabInactive,
    textAlign: 'center',
  },
  labelOn: { color: RenovaTheme.colors.tabActive },
});
