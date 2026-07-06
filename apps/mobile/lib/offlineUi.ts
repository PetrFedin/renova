/** Человеческие сообщения для офлайн-очереди — без технического offline_queued */
import { Alert } from 'react-native';

export function isOfflineQueued(e: unknown): boolean {
  return e instanceof Error && e.message === 'offline_queued';
}

/** Короткое уведомление вместо сырого кода ошибки */
export function notifyOfflineQueued(actionLabel = 'Действие'): void {
  Alert.alert('Нет сети', `${actionLabel} выполнится автоматически при подключении к интернету.`);
}
