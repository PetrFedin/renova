/**
 * Компактный числовой badge навигации.
 * tone=danger — непрочитанные сообщения; tone=warning — задачи (не подменять смысл слота).
 */
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { formatNavBadgeDisplay } from '@/lib/domain/navigationBadges';

export function ChatBadge({
  count,
  size = 18,
  inline,
  tone = 'danger',
}: {
  count: number;
  size?: number;
  inline?: boolean;
  tone?: 'danger' | 'warning';
}) {
  const label = formatNavBadgeDisplay(count);
  if (!label) return null;
  return (
    <View
      style={[
        s.badge,
        tone === 'warning' ? s.warning : s.danger,
        inline ? s.inline : null,
        { minWidth: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Text style={s.text}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    position: 'absolute',
    top: -4,
    right: -6,
    zIndex: 2,
  },
  danger: { backgroundColor: RenovaTheme.colors.danger },
  warning: { backgroundColor: RenovaTheme.colors.warning },
  inline: { position: 'relative', top: 0, right: 0, marginTop: 4 },
  text: { color: RenovaTheme.colors.surface, fontSize: 10, fontWeight: '800' },
});
