/** Состояние загрузки: честно «грузим», а не пустой список и не нули. */
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';

type Props = {
  title?: string;
};

export function LoadingState({ title = 'Загружаем…' }: Props) {
  return (
    <View style={s.wrap} accessibilityRole="progressbar" accessibilityLabel={title}>
      <ActivityIndicator color={RenovaTheme.colors.primary} />
      <Text style={s.text}>{title}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 24, gap: 10, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 13, color: RenovaTheme.colors.textMuted },
});
