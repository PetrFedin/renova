/** W52: system Share sheet wrapper. */
import { Share, Platform } from 'react-native';
import { messengerShareMessage } from '@/lib/messengerGap';
import { notifyInfo } from '@/lib/notify';

export { MESSENGER_GAP, messengerShareMessage } from '@/lib/messengerGap';

/**
 * Системное «Поделиться»; в веб-браузерах без Web Share API (десктопный Chrome, Firefox)
 * RN `Share.share` отклоняется, и кнопка раньше «молчала» — теперь текст копируется в буфер.
 */
export async function shareText(message: string, title = 'Renova', url?: string): Promise<void> {
  try {
    if (Platform.OS === 'ios' && url) await Share.share({ message, url });
    else await Share.share({ message, title });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return; // пользователь закрыл окно
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(message);
        notifyInfo('Скопировано', 'Текст в буфере обмена — вставьте его в мессенджер.');
        return;
      } catch {
        // падаем в общее сообщение ниже
      }
    }
    notifyInfo('Не удалось поделиться', 'Скопируйте текст вручную.');
  }
}

export async function shareRenovaLink(url: string, context: string): Promise<void> {
  const message = messengerShareMessage(url, context);
  await shareText(message, context, url);
}
