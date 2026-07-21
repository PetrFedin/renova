/** Инлайн-ошибка загрузки — не маскируется под empty */
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { appErrorMessage, type AppError } from '@/lib/async';
import { RetryButton } from './RetryButton';

export function InlineError({
  error,
  title = 'Не удалось загрузить',
  onRetry,
  busy,
}: {
  error?: AppError | null;
  title?: string;
  onRetry?: () => void;
  busy?: boolean;
}) {
  return (
    <View style={s.box} accessibilityRole="alert">
      <Text style={s.title}>{title}</Text>
      <Text style={s.msg}>{appErrorMessage(error)}</Text>
      {onRetry ? <RetryButton onPress={onRetry} busy={busy} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    marginVertical: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: RenovaTheme.colors.dangerBg,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.dangerBorder,
    gap: 8,
  },
  title: { fontWeight: '700', fontSize: 14, color: RenovaTheme.colors.dangerText },
  msg: { fontSize: 13, color: RenovaTheme.colors.text, lineHeight: 18 },
});
