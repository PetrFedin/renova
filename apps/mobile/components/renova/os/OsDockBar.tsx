/** Нижняя панель — 5 кнопок, dynamic preset или настройки пользователя */
import { useCallback, useMemo, useState, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import type { PressableStateCallbackType } from 'react-native';
import { router, usePathname, useFocusEffect, useGlobalSearchParams } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import { TabIcon } from '@/components/renova/TabIcon';
import { Ionicons } from '@expo/vector-icons';
import { ChatBadge } from '@/components/renova/chat/ChatBadge';
import { DOCK_BY_ID, type DockItemId } from '@/constants/dockBar';
import { getDockBar, subscribeDockBar } from '@/lib/dockBarPrefs';
import {
  customerProfileTabHref,
  parseOsHref,
  tabsRoute,
  type OsRole,
} from '@/constants/osSections';
import { useBottomInset } from '@/lib/useTopInset';
import { useRenova } from '@/lib/context/RenovaContext';
import { useChatUnread } from '@/lib/useChatUnread';
import { dockChatBadgeCount } from '@/lib/domain/headerChatBadges';
import { useTodayTaskCount } from '@/lib/useTodayTaskCount';
import { useDetailLevel } from '@/lib/useDetailLevel';
import { dockItemLabel } from '@/lib/detailLevelPolicy';
import { minimalSnapFromProject, resolveDynamicDockItems } from '@/lib/domain/resolveDynamicDock';
import { reportCatch } from '@/lib/reportError';
import { activeDockItemId, getBudgetHubLabel } from '@/lib/navigation/navigationPolicy';

export function OsDockBar({ role, orientation = 'bottom' }: { role: OsRole; orientation?: 'bottom' | 'side' }) {
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const [sideExpanded, setSideExpanded] = useState(width >= 1180);
  const [sideUserSet, setSideUserSet] = useState(false);
  // Именно global: док рисует **макет** `(tabs)`, а `tab=estimate` принадлежит
  // открытому экрану. Локальный хук отдаёт параметры своего маршрута, то есть
  // макета, и до дока `tab` не доходил вовсе — кнопка «Смета» никогда не
  // подсвечивалась, вместо неё горел «Объект».
  const params = useGlobalSearchParams<Record<string, string | string[]>>();
  const bottomPad = useBottomInset();
  const { user, activeProject } = useRenova();
  const detailLevel = useDetailLevel();
  const { count: chatUnreadRaw } = useChatUnread(user?.id, user?.role);
  /** W80: то же число, что красный бейдж на «Ещё» при chatUnread > 0 */
  const chatUnread = dockChatBadgeCount(chatUnreadRaw);
  const { count: todayTasks } = useTodayTaskCount(user?.id, activeProject?.id, role);
  const [items, setItems] = useState<DockItemId[]>(['home', 'chat', 'object', 'repair', 'budget']);

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
  const applyItems = useCallback((next: readonly DockItemId[]) => {
    setItems((prev) => {
      if (prev.length === next.length && prev.every((id, i) => id === next[i])) return prev;
      return [...next];
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

  useEffect(() => {
    if (orientation !== 'side' || sideUserSet) return;
    // Tablet starts compact; desktop uses the wider labelled navigation by default.
    setSideExpanded(width >= 1180);
  }, [orientation, sideUserSet, width]);

  const activeId = activeDockItemId(items, { pathname, params });

  const go = (id: DockItemId) => {
    const item = DOCK_BY_ID[id];
    if (!item) return;
    if (id === 'contractor') {
      router.navigate(parseOsHref(customerProfileTabHref(role, 'contractor')) as never);
      return;
    }
    router.navigate(tabsRoute(role, item.routeName, item.hubTab) as never);
  };

  const isSide = orientation === 'side';

  return (
    <View
      testID={isSide ? 'os-side-nav' : 'os-bottom-nav'}
      style={[
        s.bar,
        isSide && s.sideBar,
        isSide && (sideExpanded ? s.sideBarExpanded : s.sideBarCollapsed),
        { paddingBottom: isSide ? 0 : bottomPad },
      ]}
    >
      {isSide ? (
        <Pressable
          testID="os-side-nav-toggle"
          style={({ pressed }: PressableStateCallbackType) => [s.sideToggle, pressed && s.pressed]}
          accessibilityRole="button"
          accessibilityLabel={sideExpanded ? 'Свернуть панель разделов' : 'Развернуть панель разделов'}
          onPress={() => {
            setSideUserSet(true);
            setSideExpanded((value) => !value);
          }}
        >
          <Ionicons name={sideExpanded ? 'chevron-back-outline' : 'chevron-forward-outline'} size={20} color={RenovaTheme.colors.textMuted} />
          {sideExpanded ? <Text style={s.sideToggleLabel}>Разделы</Text> : null}
        </Pressable>
      ) : null}
      {items.map((id) => {
        const item = DOCK_BY_ID[id];
        if (!item) return null;
        const active = activeId === id;
        const color = active ? RenovaTheme.colors.tabActive : RenovaTheme.colors.tabInactive;
        const canonicalLabel = id === 'budget' ? getBudgetHubLabel(role) : item.label;
        const label = dockItemLabel(id, role, canonicalLabel);
        return (
          <Pressable
            key={id}
            testID={`os-dock-${id}${active ? '-active' : ''}`}
            style={({ pressed }: PressableStateCallbackType) => [
              s.tab,
              isSide && s.sideTab,
              isSide && sideExpanded && s.sideTabExpanded,
              active && isSide && s.sideTabActive,
              pressed && s.pressed,
            ]}
            onPress={() => go(id)}
            accessibilityRole="button"
            accessibilityLabel={
              id === 'chat' && chatUnread > 0
                ? `${label}, ${chatUnread > 99 ? '99+' : chatUnread} непрочитанных`
                : label
            }
            accessibilityState={active ? { selected: true } : {}}
          >
            <View style={s.iconWrap}>
              <TabIcon name={item.icon} color={color} size={22} />
              {id === 'chat' && <ChatBadge count={chatUnread} />}
              {id === 'calendar' && todayTasks > 0 && <ChatBadge count={todayTasks} />}
              {id === 'home' && !items.includes('calendar') && todayTasks > 0 && (
                <ChatBadge count={todayTasks} />
              )}
            </View>
            {!isSide || sideExpanded ? (
              <Text style={[s.label, isSide && s.sideLabel, active && s.labelOn]} numberOfLines={1}>{label}</Text>
            ) : null}
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
  sideBar: {
    flexDirection: 'column',
    minHeight: 0,
    paddingTop: 10,
    paddingHorizontal: 8,
    borderTopWidth: 0,
    borderRightWidth: 1,
    borderRightColor: RenovaTheme.colors.border,
    gap: 4,
  },
  sideBarCollapsed: { width: 72 },
  sideBarExpanded: { width: 216 },
  sideToggle: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: RenovaTheme.radius.sm,
    marginBottom: 4,
  },
  sideToggleLabel: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.textMuted },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
    paddingHorizontal: 2,
    paddingVertical: 4,
  },
  sideTab: {
    flex: 0,
    width: '100%',
    minHeight: 52,
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRadius: RenovaTheme.radius.sm,
  },
  sideTabExpanded: {
    minHeight: 48,
    flexDirection: 'row',
    justifyContent: 'flex-start',
    paddingHorizontal: 12,
    gap: 8,
  },
  sideTabActive: { backgroundColor: RenovaTheme.colors.surfaceMuted },
  pressed: { opacity: 0.65 },
  iconWrap: {
    position: 'relative',
    width: 32,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 3,
    lineHeight: 12,
    color: RenovaTheme.colors.tabInactive,
    textAlign: 'center',
  },
  sideLabel: { fontSize: 13, lineHeight: 18, marginTop: 0, textAlign: 'left', flexShrink: 1 },
  labelOn: { color: RenovaTheme.colors.tabActive },
});
