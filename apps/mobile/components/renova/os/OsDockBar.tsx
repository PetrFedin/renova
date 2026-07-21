/** Нижняя панель — 5 кнопок, dynamic preset или настройки пользователя */
import { useCallback, useMemo, useState, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router, usePathname, useFocusEffect } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import { TabIcon } from '@/components/renova/TabIcon';
import { ChatBadge } from '@/components/renova/chat/ChatBadge';
import { DOCK_BY_ID, type DockItemId } from '@/constants/dockBar';
import { getDockBar, subscribeDockBar } from '@/lib/dockBarPrefs';
import {
  customerProfileTabHref,
  parseOsHref,
  resolveSectionId,
  tabsRoute,
  type OsRole,
} from '@/constants/osSections';
import { useBottomInset } from '@/lib/useTopInset';
import { useRenova } from '@/lib/context/RenovaContext';
import { useChatUnread } from '@/lib/useChatUnread';
import { dockChatBadgeCount } from '@/lib/domain/headerChatBadges';
import { formatDockChatA11y } from '@/lib/domain/unreadScope';
import { useTodayTaskCount } from '@/lib/useTodayTaskCount';
import { useDetailLevel } from '@/lib/useDetailLevel';
import { dockItemLabel } from '@/lib/detailLevelPolicy';
import { minimalSnapFromProject, resolveDynamicDockItems } from '@/lib/domain/resolveDynamicDock';
import { reportCatch } from '@/lib/reportError';

const REPAIR_SEGMENTS = new Set(['repair', 'works', 'materials', 'control', 'stages']);
const OBJECT_SEGMENTS = new Set(['object', 'rooms', 'estimate', 'plan']);

export function OsDockBar({ role }: { role: OsRole }) {
  const pathname = usePathname();
  const bottomPad = useBottomInset();
  const { user, activeProject } = useRenova();
  const detailLevel = useDetailLevel();
  const { count: chatUnreadRaw } = useChatUnread(user?.id, user?.role);
  /** Dock: только global scope — не зависит от фильтра списка чатов */
  const chatUnread = dockChatBadgeCount(chatUnreadRaw);
  const { count: todayTasks, reliable: todayTasksReliable, overdue: overdueTasks } = useTodayTaskCount(
    user?.id,
    activeProject?.id,
    role,
  );
  const [items, setItems] = useState<DockItemId[]>(['home', 'chat', 'object', 'repair', 'budget']);
  const section = resolveSectionId(pathname);
  const seg = pathname.split('/').filter(Boolean).pop() || 'index';

  const dynamicItems = useMemo(() => {
    if (!activeProject) return null;
    return resolveDynamicDockItems(
      activeProject,
      minimalSnapFromProject(activeProject),
      role,
      detailLevel,
    );
  }, [activeProject, role, detailLevel]);

  /** Не вызываем setState, если состав кнопок тот же — иначе цикл с новой ссылкой массива. */
  const applyItems = useCallback((next: DockItemId[]) => {
    setItems((prev) => {
      if (prev.length === next.length && prev.every((id, i) => id === next[i])) return prev;
      return next;
    });
  }, []);

  const reloadPrefs = useCallback(() => {
    getDockBar(role).then(applyItems).catch(reportCatch('components.renova.os.OsDockBar.1'));
  }, [role, applyItems]);

  useFocusEffect(useCallback(() => {
    if (dynamicItems) applyItems(dynamicItems);
    else reloadPrefs();
  }, [dynamicItems, reloadPrefs, applyItems]));

  useEffect(() => {
    if (dynamicItems) applyItems(dynamicItems);
  }, [dynamicItems, applyItems]);

  useEffect(() => subscribeDockBar(() => {
    if (!dynamicItems) reloadPrefs();
  }), [dynamicItems, reloadPrefs]);

  const isActive = (id: DockItemId) => {
    const item = DOCK_BY_ID[id];
    if (!item) return false;
    if (item.routeName === 'index') return seg === 'index' || seg === '(tabs)' || section === 'home';
    if (id === 'estimate') return OBJECT_SEGMENTS.has(seg) || section === 'object';
    if (id === 'object') return OBJECT_SEGMENTS.has(seg) || section === 'object';
    if (id === 'contractor' || id === 'more') return seg === 'profile';
    if (id === 'calendar') return seg === 'calendar';
    if (id === 'repair') return seg === 'repair' || REPAIR_SEGMENTS.has(seg);
    if (id === 'budget') return seg === 'budget' || seg === 'finance' || seg === 'money' || section === 'budget';
    if (id === 'chat') return seg === 'chat';
    return seg === item.routeName || item.id === section;
  };

  const go = (id: DockItemId) => {
    const item = DOCK_BY_ID[id];
    if (!item) return;
    if (id === 'contractor') {
      router.navigate(parseOsHref(customerProfileTabHref(role, 'contractor')) as any);
      return;
    }
    router.navigate(tabsRoute(role, item.routeName, item.hubTab) as any);
  };

  return (
    <View style={[s.bar, { paddingBottom: bottomPad }]}>
      {items.map((id) => {
        const item = DOCK_BY_ID[id];
        if (!item) return null;
        const active = isActive(id);
        const color = active ? RenovaTheme.colors.tabActive : RenovaTheme.colors.tabInactive;
        const label = dockItemLabel(id, role, item.label);
        return (
          <Pressable
            key={id}
            style={({ pressed }) => [s.tab, pressed && s.pressed]}
            onPress={() => go(id)}
            accessibilityRole="button"
            accessibilityLabel={
              id === 'chat' && chatUnread > 0
                ? formatDockChatA11y(chatUnread)
                : label
            }
            accessibilityState={active ? { selected: true } : {}}
          >
            <View style={s.iconWrap}>
              <TabIcon name={item.icon} color={color} size={22} />
              {id === 'chat' && <ChatBadge count={chatUnread} />}
              {/* Calendar badge = dueToday only; не переносим на home при отсутствии calendar в dock */}
              {id === 'calendar' && todayTasksReliable && todayTasks > 0 && <ChatBadge count={todayTasks} />}
              {id === 'calendar' && todayTasksReliable && overdueTasks > 0 && (
                <View
                  style={s.overdueDot}
                  accessibilityLabel={`Просрочено: ${overdueTasks}`}
                />
              )}
            </View>
            <Text style={[s.label, active && s.labelOn]} numberOfLines={1}>{label}</Text>
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
  iconWrap: {
    position: 'relative',
    width: 32,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  /** Отдельный визуальный сигнал overdue (не смешивать с dueToday badge) */
  overdueDot: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: RenovaTheme.colors.warning,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.surface,
  },
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
