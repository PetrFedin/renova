/** Понятная ошибка загрузки + «Повторить» (a11y). */
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { dangerSurface } from '@/constants/uiTokens';

type Props = {
  title?: string;
  message: string;
  onRetry: () => void;
  retryLabel?: string;
  /** Компактный режим внутри секции (не на весь экран) */
  compact?: boolean;
  loading?: boolean;
  /** accessibilityLabel для кнопки retry */
  accessibilityRetryLabel?: string;
};

export function InlineLoadError({
  title = 'Не удалось загрузить',
  message,
  onRetry,
  retryLabel = 'Повторить',
  compact,
  loading,
  accessibilityRetryLabel,
}: Props) {
  return (
    <View
      style={[s.box, compact ? s.compact : null, dangerSurface]}
      accessibilityRole="alert"
      accessibilityLabel={`${title}. ${message}`}
    >
      <Text style={s.title}>{title}</Text>
      <Text style={s.message}>{message}</Text>
      <Pressable
        style={[s.btn, loading && s.btnDisabled]}
        onPress={onRetry}
        disabled={loading}
        accessibilityRole="button"
        accessibilityLabel={accessibilityRetryLabel || retryLabel}
        accessibilityState={{ disabled: Boolean(loading), busy: Boolean(loading) }}
      >
        {loading ? (
          <ActivityIndicator color={RenovaTheme.colors.dangerText} />
        ) : (
          <Text style={s.btnT}>{retryLabel}</Text>
        )}
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 10,
    gap: 6,
  },
  compact: {
    padding: 12,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: RenovaTheme.colors.dangerText,
  },
  message: {
    fontSize: 13,
    color: RenovaTheme.colors.text,
    lineHeight: 18,
  },
  btn: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.dangerText,
    backgroundColor: RenovaTheme.colors.surface,
    minWidth: 96,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  btnT: {
    fontSize: 14,
    fontWeight: '700',
    color: RenovaTheme.colors.dangerText,
  },
});
