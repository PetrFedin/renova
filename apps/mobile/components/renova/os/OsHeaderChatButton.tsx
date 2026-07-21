/** Верхняя иконка сообщений — красный totalUnread (= dock «Сообщения»). */
import { Pressable, StyleSheet, View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RenovaTheme } from '@/constants/Theme';
import { useRenova } from '@/lib/context/RenovaContext';
import { useChatUnread } from '@/lib/useChatUnread';
import { dockChatBadgeCount } from '@/lib/domain/headerChatBadges';
import { chatMessagesA11yLabel } from '@/lib/domain/moreMenuA11y';
import { formatBadgeCount } from '@/lib/formatUnreadMessagesRu';
import { pushOsTabNav } from '@/lib/osTabNav';
import { usePathname } from 'expo-router';
import type { OsRole } from '@/constants/osSections';

export function OsHeaderChatButton({ role }: { role: OsRole }) {
  const pathname = usePathname();
  const { user } = useRenova();
  const { count: raw } = useChatUnread(user?.id, user?.role);
  const count = dockChatBadgeCount(raw);
  const label = formatBadgeCount(count);

  return (
    <Pressable
      style={s.btn}
      onPress={() => pushOsTabNav(role, 'chat', undefined, undefined, pathname)}
      accessibilityRole="button"
      accessibilityLabel={chatMessagesA11yLabel(count)}
      hitSlop={8}
    >
      <Ionicons name="chatbubble-ellipses-outline" size={22} color={RenovaTheme.colors.text} />
      {label ? (
        <View style={s.badge} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={s.badgeT}>{label}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
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
});
