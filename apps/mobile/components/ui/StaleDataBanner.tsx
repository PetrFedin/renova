/** Неблокирующий баннер: показаны ранее загруженные данные после ошибки refresh. */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { warningSurface } from '@/constants/uiTokens';

type Props = {
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  accessibilityRetryLabel?: string;
};

export function StaleDataBanner({
  message = 'Показаны ранее загруженные данные — обновить не удалось.',
  onRetry,
  retryLabel = 'Повторить',
  accessibilityRetryLabel,
}: Props) {
  return (
    <View style={[s.box, warningSurface]} accessibilityRole="alert" accessibilityLabel={message}>
      <View style={s.body}>
        <Text style={s.title}>Данные могут быть устаревшими</Text>
        <Text style={s.sub}>{message}</Text>
      </View>
      {onRetry ? (
        <Pressable
          style={s.btn}
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel={accessibilityRetryLabel || retryLabel}
        >
          <Text style={s.btnT}>{retryLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 10,
    marginBottom: 10,
  },
  body: { flex: 1, minWidth: 0 },
  title: { fontWeight: '700', fontSize: 13, color: RenovaTheme.colors.text },
  sub: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 2, lineHeight: 15 },
  btn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: RenovaTheme.colors.surface,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
  },
  btnT: { fontWeight: '700', fontSize: 12, color: RenovaTheme.colors.primary },
});
