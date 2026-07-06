/** Текстовая ссылка — accent, без стрелки в title кнопки */
import { Pressable, Text, StyleSheet } from 'react-native';
import { typography } from '@/constants/typography';

export function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="link">
      <Text style={[typography.link, s.link]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  link: { textDecorationLine: 'none' },
});
