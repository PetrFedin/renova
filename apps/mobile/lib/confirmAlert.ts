/** Подтверждение destructive-действий — OS sheet (Clarity P), web: window.confirm. */
import { Platform } from 'react-native';
import { showActionConfirm } from '@/lib/actionConfirmBus';

export function confirmDestructive(title: string, message: string): Promise<boolean> {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.confirm === 'function') {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    let settled = false;
    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    showActionConfirm({
      title,
      message,
      primaryLabel: 'Подтвердить',
      onPrimary: () => settle(true),
      secondaryLabel: 'Отмена',
      onSecondary: () => settle(false),
      onDismiss: () => settle(false),
    });
  });
}

export function alertMessage(title: string, message: string): void {
  // Info-only: единый sheet без Promise
  showActionConfirm({
    title,
    message,
  });
}
