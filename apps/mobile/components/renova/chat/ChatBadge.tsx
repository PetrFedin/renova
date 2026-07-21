/** Badge непрочитанных — компактный круг */
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { formatBadgeCount } from '@/lib/i18n';

export function ChatBadge({ count, size = 18, inline }: { count: number; size?: number; inline?: boolean }) {
  const label = formatBadgeCount(count);
  if (!label) return null;
  return (
    <View style={[s.badge, inline ? s.inline : null, { minWidth: size, height: size, borderRadius: size / 2 }]}>
      <Text style={s.text}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  badge: {
    backgroundColor: RenovaTheme.colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    position: 'absolute',
    top: -4,
    right: -6,
    zIndex: 2,
  },
  inline: { position: 'relative', top: 0, right: 0, marginTop: 4 },
  text: { color: RenovaTheme.colors.surface, fontSize: 10, fontWeight: '800' },
});
