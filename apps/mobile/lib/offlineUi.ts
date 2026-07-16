/** Человеческие сообщения для офлайн-очереди — без технического offline_queued */
import { Alert } from 'react-native';
import { OFFLINE_MESSAGES } from '@/lib/offlineErrors';

export function isOfflineQueued(e: unknown): boolean {
  return e instanceof Error && e.message === 'offline_queued';
}

export function isOfflineBlocked(e: unknown): string | null {
  if (e instanceof Error && e.message in OFFLINE_MESSAGES) return e.message;
  return null;
}

/** Короткое уведомление вместо сырого кода ошибки */
export function notifyOfflineQueued(actionLabel = 'Действие'): void {
  Alert.alert('Нет сети', `${actionLabel} выполнится автоматически при подключении к интернету.`);
}

export function notifyOfflineBlocked(e: unknown, fallback = 'Действие недоступно без интернета.'): void {
  const code = isOfflineBlocked(e);
  Alert.alert('Нет сети', code ? OFFLINE_MESSAGES[code] : fallback);
}
