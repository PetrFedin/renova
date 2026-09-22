/** Clarity B: единый экран ошибки загрузки — не маскировать под empty */
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { tabsRoute, type OsRole } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import { loadErrorHint, retryIsImmediate } from '@/lib/domain/loadErrorHint';

type Props = {
  title?: string;
  hint?: string;
  onRetry: () => void;
  /**
   * Сама ошибка: по ней подбирается честная подсказка. Без неё остаётся
   * прежний текст про сеть — для вызывающих, которые ошибку не сохраняют.
   */
  error?: unknown;
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
  const resolvedHint = hint ?? loadErrorHint(error);
  const immediate = retryIsImmediate(error);
  return (
    <View style={s.wrap} accessibilityRole="summary">
      <Text style={s.title}>{title}</Text>
      <Text style={s.hint}>{resolvedHint}</Text>
      <PrimaryButton title={immediate ? 'Повторить' : 'Повторить позже'} onPress={onRetry} />
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
