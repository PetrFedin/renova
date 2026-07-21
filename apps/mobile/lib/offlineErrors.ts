/** User-facing offline block codes — см. offlineUi.ts для Alert-текстов */
export const OFFLINE_UPLOAD_BLOCKED = 'offline_upload_blocked';
export const OFFLINE_PAYMENT_CREATE_BLOCKED = 'offline_payment_create_blocked';

export const OFFLINE_MESSAGES: Record<string, string> = {
  offline_upload_blocked: 'Загрузка файлов недоступна без интернета. Подключитесь к сети и повторите.',
  offline_payment_create_blocked: 'Создание платежа недоступно офлайн. Подключитесь к сети.',
  offline_queued: 'Действие выполнится при подключении к интернету.',
};
