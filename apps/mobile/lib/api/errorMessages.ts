/**
 * Человеческий текст вместо кода ошибки.
 *
 * Бэкенд поднимает `HTTPException(403, "technical_supervision_customer_only")`,
 * а клиент показывал это как есть:
 *
 *     return { message: j.detail, code: j.detail, detail };
 *
 * То есть пользователь видел в алерте `technical_supervision_customer_only`.
 * Таких кодов в бэкенде сто штук, и список растёт с каждым маршрутом.
 *
 * Поэтому здесь не только словарь. Словарь покрывает случаи, где важна
 * конкретная подсказка — что именно сделать дальше. Всё остальное разбирается
 * по форме кода: `*_not_found`, `*_only`, `*_forbidden`, `invalid_*` — у них
 * есть общий смысл, который можно сказать по-русски, не зная кода в лицо.
 * Последний рубеж — общая фраза. Ни при каком коде наружу не должно выйти
 * `snake_case`: новый код на бэкенде не должен попадать в интерфейс сырым.
 */

/** Точные формулировки там, где общего смысла мало. */
const EXACT: Record<string, string> = {
  // Доступ и роли
  no_access: 'Нет доступа к этому объекту',
  project_forbidden: 'Нет доступа к этому объекту',
  field_write_forbidden: 'Изменять это может только исполнитель на объекте',
  communication_forbidden: 'Переписка по этому объекту недоступна',
  customer_only: 'Это действие доступно заказчику',
  contractor_only: 'Это действие доступно исполнителю',
  assigned_contractor_only: 'Это действие доступно исполнителю, назначенному на объект',
  accept_stage_only_for_customer: 'Принять этап может только заказчик',
  pay_only_for_customer: 'Оплатить может только заказчик',
  sign_customer_only: 'Подписать может только заказчик',
  closeout_customer_only: 'Закрыть объект может только заказчик',
  estimate_lock_customer_only: 'Зафиксировать смету может только заказчик',
  estimate_lock_contractor_owner_only: 'Зафиксировать смету может только владелец сметы',
  estimate_reject_customer_only: 'Отклонить смету может только заказчик',
  change_order_customer_only: 'Решение по изменению принимает заказчик',
  acceptance_decision_customer_only: 'Решение по приёмке принимает заказчик',
  warranty_close_customer_only: 'Закрыть гарантийное обращение может только заказчик',
  technical_supervision_customer_only: 'Назначает технадзор только заказчик',
  technical_supervision_history_customer_only: 'История технадзора доступна заказчику',
  only_customer_can_confirm_payment: 'Подтвердить оплату может только заказчик',
  only_contractor_can_invoice_from_chat: 'Выставить счёт из чата может только исполнитель',
  lead_owner_only: 'Это заявка другого исполнителя',
  escalate_foreman_or_owner_only: 'Эскалировать может бригадир или владелец бригады',
  schedule_foreman_or_owner_only: 'Изменить график может бригадир или владелец бригады',
  portal_link_customer_or_contractor_only: 'Ссылку на портал создаёт заказчик или исполнитель',

  // Портал и сессии
  portal_read_only: 'Гостевой доступ только для просмотра',
  portal_pay_scope_required: 'Эта ссылка не даёт права на оплату',
  invalid_portal_token: 'Ссылка на портал недействительна или истекла',
  portal_token_mismatch: 'Ссылка на портал не подходит к этому объекту',
  token_project_mismatch: 'Ссылка не подходит к этому объекту',
  token_mismatch: 'Ссылка недействительна',
  invalid_token_user: 'Ссылка выдана другому пользователю',
  session_revoked: 'Сессия завершена. Войдите заново',
  invalid_or_expired_refresh: 'Сессия истекла. Войдите заново',
  account_deleted: 'Аккаунт удалён',
  registration_via_sms_only: 'Регистрация возможна только по SMS',
  user_exists_use_sms: 'Такой пользователь уже есть — войдите по SMS',

  // Состояния, при которых действие не имеет смысла
  not_proposed: 'Предложение ещё не отправлено',
  not_available: 'Сейчас это недоступно',
  lead_already_assigned: 'Заявку уже взял другой исполнитель',
  lead_not_open: 'Заявка больше не открыта',
  lead_not_assignable: 'Эту заявку нельзя назначить',
  lead_not_ready_for_conversion: 'Заявка ещё не готова к переводу в объект',
  lead_has_no_contractor: 'У заявки нет исполнителя',
  no_contractors: 'Подходящих исполнителей не нашлось',
  no_customer_on_project: 'На объекте нет заказчика',
  not_a_warranty_claim: 'Это не гарантийное обращение',
  document_not_signable: 'Этот документ нельзя подписать',
  document_has_no_version: 'У документа нет ни одной версии',
  schedule_must_be_submitted_before_reject: 'Сначала график нужно отправить на согласование',
  schedule_rejection_reason_required: 'Укажите причину отклонения',
  idempotency_conflict: 'Это действие уже выполняется. Подождите результат',
  duplicate_provider_external_id: 'Такая запись уже создана',
  invite_requires_exactly_one_target: 'Укажите либо телефон, либо ссылку — что-то одно',
  read_cursor_not_in_thread: 'Сообщение не из этого чата',

  // Ввод
  empty_file: 'Файл пустой',
  file_too_large: 'Файл слишком большой',
  status_required: 'Не указан статус',
  external_id_required: 'Не указан внешний идентификатор',
  payment_ids_required: 'Не выбрано ни одной оплаты',
  payment_project_mismatch: 'Оплата относится к другому объекту',
  quality_issue_title_invalid: 'Опишите замечание понятнее',
  quality_issue_coordinates_invalid: 'Точка выходит за пределы плана',
  quality_issue_severity_invalid: 'Выберите важность замечания',

  // Конфигурация — пользователь тут ни при чём, но и код ему ни к чему
  demo_disabled: 'Демо-режим выключен',
  account_purge_disabled: 'Удаление аккаунта сейчас недоступно',
  esign_webhook_secret_missing: 'Подписание документов не настроено',
  yookassa_webhook_secret_not_configured: 'Приём платежей не настроен',
  invalid_webhook_secret: 'Приём платежей не настроен',
  invalid_webhook_json: 'Приём платежей не настроен',
  unsupported_esign_status: 'Подписание документов не настроено',
  token_validation_failed: 'Не удалось проверить ссылку',
  session_validation_failed: 'Не удалось проверить сессию',

  rate_limit: 'Слишком много запросов. Подождите несколько секунд и повторите.',
};

/** Полная фраза, а не подлежащее: род выводить не нужно, значит и ломаться нечему. */
const NOT_FOUND: Record<string, string> = {
  project: 'Объект не найден',
  stage: 'Этап не найден',
  chat: 'Чат не найден',
  message: 'Сообщение не найдено',
  document: 'Документ не найден',
  document_or_project: 'Документ не найден',
  signature: 'Подпись не найдена',
  user: 'Пользователь не найден',
  viewer: 'Участник не найден',
  contractor_profile: 'Профиль исполнителя не найден',
  lead: 'Заявка не найдена',
  quote: 'Предложение не найдено',
  change_order: 'Изменение не найдено',
  acceptance: 'Приёмка не найдена',
  warranty: 'Гарантийное обращение не найдено',
  schedule: 'График не найден',
  work_schedule: 'График работ не найден',
  waste_order: 'Заказ на вывоз мусора не найден',
  quality_issue_room: 'Комната не найдена',
  quality_issue_stage: 'Этап не найден',
  quality_issue_floor_plan: 'План этажа не найден',
  technical_supervision_assignment: 'Назначение технадзора не найдено',
};

const GENERIC = 'Не удалось выполнить действие. Попробуйте ещё раз';

function looksLikeCode(value: string): boolean {
  // snake_case без пробелов и без кириллицы — это идентификатор, не текст.
  return /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(value.trim());
}

function fromShape(code: string): string | null {
  const suffixed = (suffix: string) =>
    code.endsWith(suffix) ? code.slice(0, -suffix.length) : null;

  const missing = suffixed('_not_found') ?? suffixed('_missing');
  if (missing !== null) return NOT_FOUND[missing] || 'Запись не найдена';
  if (code.endsWith('_only')) return 'У вас нет прав на это действие';
  if (code.endsWith('_forbidden') || code.endsWith('_denied')) return 'Действие недоступно';
  if (code.endsWith('_required')) return 'Не хватает обязательных данных';
  if (code.startsWith('invalid_') || code.endsWith('_invalid')) return 'Неверные данные';
  if (code.endsWith('_mismatch')) return 'Данные не совпадают';
  if (code.endsWith('_disabled')) return 'Функция сейчас выключена';
  return null;
}

/**
 * Текст для пользователя по коду ошибки.
 *
 * `fallback` — то, что прислал сервер в поле message. Он используется, только
 * если это действительно фраза, а не идентификатор.
 */
export function messageForErrorCode(
  code: string | undefined,
  fallback?: string,
  status?: number,
): string {
  const normalized = (code || '').trim();
  if (normalized && EXACT[normalized]) return EXACT[normalized];

  if (fallback && fallback.trim() && !looksLikeCode(fallback)) {
    return fallback.trim();
  }

  if (normalized) {
    const shaped = fromShape(normalized);
    if (shaped) return shaped;
  }

  if (status === 429) return EXACT.rate_limit;
  if (status === 401 || status === 403) return 'Нет доступа к этому действию';
  if (status === 404) return 'Запись не найдена';
  if (status && status >= 500) return 'Сервис временно недоступен. Попробуйте позже';
  return GENERIC;
}
