/** Полоска «Назад · …» — когда перешли с другого экрана OS (returnTo в URL) */
import { Pressable, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import { goBack } from '@/lib/navigation';
import { returnToLabel } from '@/lib/osReturnTo';
import type { OsRole } from '@/constants/osSections';

export function OsReturnBar({ role }: { role: OsRole }) {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const rt = Array.isArray(returnTo) ? returnTo[0] : returnTo;
  if (!rt) return null;

  const label = returnToLabel(rt, role);
  const text = label ? `Назад · ${label}` : 'Назад';

  return (
    <Pressable
      style={s.bar}
      onPress={() => goBack(rt, role)}
      accessibilityRole="button"
      accessibilityLabel={text}
    >
      <Ionicons name="chevron-back" size={18} color={RenovaTheme.colors.primary} />
      <Text style={s.text} numberOfLines={1}>{text}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginHorizontal: 12,
    marginBottom: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  text: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: RenovaTheme.colors.primary,
  },
});
