/**
 * Единый кроссплатформенный диалог/уведомление.
 *
 * react-native-web: `Alert.alert` — пустая функция (`static alert() {}`), поэтому на web
 * валидация, ошибки и подтверждения молча терялись (SCR-001/CMP-018). Здесь:
 * - native → системный Alert;
 * - web → ActionConfirmSheet через actionConfirmBus (смонтирован в RenovaContext).
 * Прямой `Alert.alert(` вне этого файла запрещён (lib/notifyGuard.test.ts).
 */
import { Alert, Platform } from 'react-native';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { describeFailure } from '@/lib/notifyMessage';

export { describeFailure, failureReason } from '@/lib/notifyMessage';

export type NotifyButton = {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
};

const useSheet = () => Platform.OS === 'web';

/** Совместим по сигнатуре с Alert.alert(title, message?, buttons?). */
export function notifyAlert(title: string, message?: string, buttons?: NotifyButton[]): void {
  if (!useSheet()) {
    const dismiss = buttons?.find((b) => b.style === 'cancel')?.onPress;
    Alert.alert(title, message, buttons?.length ? buttons : undefined, dismiss ? { cancelable: true, onDismiss: dismiss } : undefined);
    return;
  }
  const list = buttons ?? [];
  const cancel = list.find((b) => b.style === 'cancel');
  const acts = list.filter((b) => b !== cancel);
  const base = { title, message: message ?? '', onDismiss: cancel?.onPress };
  if (acts.length >= 3) {
    showActionConfirm({
      ...base,
      actions: acts.map((b) => ({
        label: b.text,
        destructive: b.style === 'destructive',
        onPress: () => b.onPress?.(),
      })),
    });
    return;
  }
  const [first, second] = acts;
  showActionConfirm({
    ...base,
    primaryLabel: first?.text,
    onPrimary: first ? () => first.onPress?.() : undefined,
    primaryDestructive: first?.style === 'destructive',
    secondaryLabel: second?.text,
    onSecondary: second ? () => second.onPress?.() : undefined,
  });
}

/** Информация / подтверждение валидации. */
export function notifyInfo(title: string, message?: string): void {
  notifyAlert(title, message);
}

/** Ошибка: заголовок — что не удалось, текст — причина из `error` (или `what`). */
export function notifyError(title: string, error?: unknown, what?: string): void {
  notifyAlert(title, describeFailure(error, what));
}

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

/** Подтверждение → реальный выбор пользователя (web: sheet, native: Alert). */
export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  const { title, message, confirmLabel = 'Подтвердить', cancelLabel = 'Отмена', destructive } = opts;
  return new Promise<boolean>((resolve) => {
    notifyAlert(title, message, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ]);
  });
}
