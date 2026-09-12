/** Clarity B: единый экран ошибки загрузки — не маскировать под empty */
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { tabsRoute, type OsRole } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import type { AppError } from '@/lib/async/appError';

type Props = {
  title?: string;
  hint?: string;
  error?: AppError;
  onRetry: () => void;
  /** Опционально — путь в чат при сбое */
  role?: OsRole;
  showChatCta?: boolean;
};

export function LoadErrorState({
  title = 'Не удалось загрузить',
  hint,
  error,
  onRetry,
  role,
  showChatCta = false,
}: Props) {
  const message = hint ?? error?.message ?? 'Проверьте сеть и повторите. Это не пустой список.';
  const canRetry = error?.retryable ?? true;

  return (
    <View style={s.wrap} accessibilityRole="summary">
      <Text style={s.title}>{title}</Text>
      <Text style={s.hint}>{message}</Text>
      {canRetry ? <PrimaryButton title="Повторить" onPress={onRetry} /> : null}
      {showChatCta && role ? (
        <PrimaryButton
          title="Написать в чат"
          variant="outline"
          onPress={() => pushOsNav(tabsRoute(role, 'chat'), undefined, role)}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 16, gap: 10, alignItems: 'stretch' },
  title: { fontSize: 15, fontWeight: '700', color: RenovaTheme.colors.text },
  hint: { fontSize: 13, color: RenovaTheme.colors.textMuted, lineHeight: 18, marginBottom: 4 },
});
