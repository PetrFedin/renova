/** Баннер: показаны прошлые данные после неудачного refresh / offline cache */
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { appErrorMessage, type AppError } from '@/lib/async';
import { RetryButton } from './RetryButton';

export function StaleDataBanner({
  error,
  offline = false,
  onRetry,
  busy,
}: {
  error?: AppError | null;
  offline?: boolean;
  onRetry?: () => void;
  busy?: boolean;
}) {
  return (
    <View style={s.box} accessibilityRole="alert">
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={s.title}>
          {offline ? 'Офлайн: показаны сохранённые данные' : 'Данные могут быть устаревшими'}
        </Text>
        <Text style={s.sub}>
          {error ? appErrorMessage(error) : 'Последнее обновление не удалось. Можно продолжить работу или повторить.'}
        </Text>
      </View>
      {onRetry ? <RetryButton onPress={onRetry} busy={busy} compact /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: RenovaTheme.colors.warningBg,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.warningBorder,
  },
  title: { fontWeight: '700', fontSize: 13, color: RenovaTheme.colors.warningText },
  sub: { fontSize: 11, color: RenovaTheme.colors.textMuted, lineHeight: 15 },
});
