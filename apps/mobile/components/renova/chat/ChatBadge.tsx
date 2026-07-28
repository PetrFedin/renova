/** Badge непрочитанных / задач дня — компактный круг */
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';

/** danger = chat unread; warning = задачи дня (не путать с непрочитанным) */
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
  if (!count || count <= 0) return null;
  const label = count > 99 ? '99+' : String(count);
  const bg = tone === 'warning' ? RenovaTheme.colors.warning : RenovaTheme.colors.danger;
  return (
    <View
      style={[
        s.badge,
        inline ? s.inline : null,
        { minWidth: size, height: size, borderRadius: size / 2, backgroundColor: bg },
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
  inline: { position: 'relative', top: 0, right: 0, marginTop: 4 },
  text: { color: RenovaTheme.colors.surface, fontSize: 10, fontWeight: '800' },
});
