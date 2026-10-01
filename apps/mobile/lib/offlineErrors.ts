/** User-facing offline block codes — см. offlineUi.ts для Alert-текстов */
export const OFFLINE_UPLOAD_BLOCKED = 'offline_upload_blocked';
export const OFFLINE_PAYMENT_CREATE_BLOCKED = 'offline_payment_create_blocked';
/** 5xx: сервер доступен, но ответ не получен — исход неизвестен (CMP-026). */
export const WRITE_RESPONSE_UNKNOWN = 'write_response_unknown';
export const UPLOAD_RESPONSE_UNKNOWN = 'upload_response_unknown';

export const OFFLINE_MESSAGES: Record<string, string> = {
  offline_upload_blocked: 'Загрузка файлов недоступна без интернета. Подключитесь к сети и повторите.',
  offline_payment_create_blocked: 'Создание платежа недоступно офлайн. Подключитесь к сети.',
  write_response_unknown: 'Ответ сервера не получен. Счёт мог быть создан — нажмите «Создать» ещё раз: повтор безопасен, дубль не появится.',
  upload_response_unknown: 'Ответ сервера не получен. Файл мог загрузиться — проверьте список документов и при необходимости повторите.',
  offline_queued: 'Действие выполнится при подключении к интернету.',
};
