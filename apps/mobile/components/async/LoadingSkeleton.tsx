/** Лёгкий скелетон первой загрузки */
import { View, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';

export function LoadingSkeleton({
  rows = 3,
  height = 56,
}: {
  rows?: number;
  height?: number;
}) {
  return (
    <View style={s.wrap} accessibilityLabel="Загрузка">
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={[s.row, { height }]} />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 10, paddingVertical: 8 },
  row: {
    borderRadius: 12,
    backgroundColor: RenovaTheme.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.borderLight,
  },
});
