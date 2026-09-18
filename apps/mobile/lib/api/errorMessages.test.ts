/**
 * Ни один код ошибки не должен дойти до пользователя сырым.
 *
 * Клиент возвращал `message: j.detail`, то есть показывал в алерте
 * `technical_supervision_customer_only`. Здесь проверяется не десяток
 * примеров, а весь список кодов, которые бэкенд действительно поднимает —
 * собран из `HTTPException(<status>, "<code>")` по app/ на момент правки.
 */
import assert from 'node:assert/strict';
import { messageForErrorCode } from './errorMessages';

/** Все коды из бэкенда: 100 штук. */
const BACKEND_CODES = [
  'accept_stage_only_for_customer', 'acceptance_decision_customer_only', 'acceptance_not_found',
  'account_deleted', 'account_purge_disabled', 'assigned_contractor_only',
  'change_order_customer_only', 'change_order_not_found', 'chat_not_found',
  'closeout_customer_only', 'communication_forbidden', 'contractor_only',
  'contractor_profile_not_found', 'customer_only', 'demo_disabled',
  'document_has_no_version', 'document_not_found', 'document_not_signable',
  'document_or_project_not_found', 'duplicate_provider_external_id', 'empty_file',
  'escalate_foreman_or_owner_only', 'esign_webhook_secret_missing',
  'estimate_lock_contractor_owner_only', 'estimate_lock_customer_only',
  'estimate_reject_customer_only', 'external_id_required', 'field_write_forbidden',
  'file_too_large', 'idempotency_conflict', 'invalid_category',
  'invalid_document_media_key', 'invalid_lead_status', 'invalid_or_expired_refresh',
  'invalid_portal_token', 'invalid_retention_until', 'invalid_status',
  'invalid_token_user', 'invalid_webhook_json', 'invalid_webhook_secret',
  'invite_requires_exactly_one_target', 'lead_already_assigned', 'lead_has_no_contractor',
  'lead_not_assignable', 'lead_not_found', 'lead_not_open',
  'lead_not_ready_for_conversion', 'lead_owner_only', 'message_not_found', 'no_access',
  'no_contractors', 'no_customer_on_project', 'not_a_warranty_claim', 'not_available',
  'not_proposed', 'only_contractor_can_invoice_from_chat', 'only_customer_can_confirm_payment',
  'pay_only_for_customer', 'payment_ids_required', 'payment_project_mismatch',
  'portal_link_customer_or_contractor_only', 'portal_pay_scope_required', 'portal_read_only',
  'portal_token_mismatch', 'project_forbidden', 'project_not_found',
  'quality_issue_coordinates_invalid', 'quality_issue_floor_plan_not_found',
  'quality_issue_room_not_found', 'quality_issue_severity_invalid',
  'quality_issue_stage_not_found', 'quality_issue_title_invalid', 'quote_not_found',
  'read_cursor_not_in_thread', 'registration_via_sms_only', 'schedule_foreman_or_owner_only',
  'schedule_must_be_submitted_before_reject', 'schedule_not_found',
  'schedule_rejection_reason_required', 'session_revoked', 'session_validation_failed',
  'sign_customer_only', 'signature_not_found', 'stage_not_found', 'status_required',
  'technical_supervision_assignment_missing', 'technical_supervision_customer_only',
  'technical_supervision_history_customer_only', 'token_mismatch', 'token_project_mismatch',
  'token_validation_failed', 'unsupported_esign_status', 'user_exists_use_sms',
  'user_not_found', 'viewer_not_found', 'warranty_close_customer_only', 'warranty_not_found',
  'waste_order_not_found', 'work_schedule_not_found', 'yookassa_webhook_secret_not_configured',
];

const SNAKE_CASE = /[a-z][a-z0-9]*_[a-z0-9]/;

// --- главное свойство: наружу не выходит идентификатор ----------------------

for (const code of BACKEND_CODES) {
  const message = messageForErrorCode(code, undefined, 403);
  assert.ok(
    !SNAKE_CASE.test(message),
    `код «${code}» показан пользователю как есть: ${message}`,
  );
  assert.ok(message.length > 3, `пустое сообщение для «${code}»`);
  assert.ok(
    /[А-Яа-яЁё]/.test(message),
    `сообщение для «${code}» не по-русски: ${message}`,
  );
}

// …и для кода, которого ещё нет: новый маршрут на бэкенде не должен протечь.
for (const future of ['brand_new_thing_not_found', 'some_future_only', 'invalid_future_thing', 'totally_unknown_code']) {
  const message = messageForErrorCode(future, undefined, 400);
  assert.ok(!SNAKE_CASE.test(message), `новый код протёк наружу: ${message}`);
}

// --- страховка от «всегда одна общая фраза» ---------------------------------
// Без этого тест выше проходил бы при `return 'Ошибка'` на всё подряд.

assert.equal(
  messageForErrorCode('technical_supervision_customer_only'),
  'Назначает технадзор только заказчик',
);
assert.equal(messageForErrorCode('project_not_found'), 'Объект не найден');
assert.equal(messageForErrorCode('quote_not_found'), 'Предложение не найдено');
assert.equal(messageForErrorCode('lead_already_assigned'), 'Заявку уже взял другой исполнитель');
assert.equal(messageForErrorCode('portal_read_only'), 'Гостевой доступ только для просмотра');

const distinct = new Set(BACKEND_CODES.map((c) => messageForErrorCode(c, undefined, 403)));
assert.ok(
  distinct.size > 40,
  `сообщения слились в общие фразы: различных всего ${distinct.size}`,
);

// --- осмысленный текст от сервера сохраняется -------------------------------

assert.equal(
  messageForErrorCode('trial_used', 'Пробный период уже использован — оформите Pro'),
  'Пробный период уже использован — оформите Pro',
);
// …а идентификатор в поле message текстом не считается.
assert.ok(!SNAKE_CASE.test(messageForErrorCode('some_code', 'some_code')));

// --- HTTP-статусы вместо «HTTP 500» ------------------------------------------

assert.match(messageForErrorCode(undefined, undefined, 500), /недоступен/);
assert.match(messageForErrorCode(undefined, undefined, 404), /не найдена/);
assert.match(messageForErrorCode(undefined, undefined, 429), /Слишком много запросов/);
assert.ok(messageForErrorCode(undefined, undefined, 418).length > 3);

console.log('errorMessages.test OK');

// --- и то же самое через сам клиент ------------------------------------------
// Словарь может быть безупречен, а клиент — его не звать. Тело ответа здесь
// ровно такой формы, какую отдаёт FastAPI на HTTPException(403, "<code>").

import { parseApiErrorBody } from './client';

const fastapi = parseApiErrorBody(
  JSON.stringify({ detail: 'technical_supervision_customer_only' }),
  403,
);
assert.equal(fastapi.message, 'Назначает технадзор только заказчик');
assert.equal(fastapi.code, 'technical_supervision_customer_only', 'код нужен логике и логам');

// Вложенная форма — HTTPException(403, {"code": ..., "message": ...}).
const structured = parseApiErrorBody(
  JSON.stringify({ detail: { code: 'team_role_change_forbidden', message: 'Роль менять нельзя' } }),
  403,
);
assert.equal(structured.message, 'Роль менять нельзя');
assert.equal(structured.code, 'team_role_change_forbidden');

// Пятисотка без тела — раньше это был текст «HTTP 500».
const crashed = parseApiErrorBody('', 500);
assert.ok(!/HTTP 500/.test(crashed.message), `сырой статус в интерфейсе: ${crashed.message}`);
assert.match(crashed.message, /недоступен/);

// Не-JSON тело: раньше уходило пользователю целиком.
const html = parseApiErrorBody('<html><body>502 Bad Gateway</body></html>', 502);
assert.ok(!/html/.test(html.message), `тело ответа показано как есть: ${html.message}`);

const limited = parseApiErrorBody(JSON.stringify({ detail: 'rate_limit' }), 429);
assert.match(limited.message, /Слишком много запросов/);
assert.equal(limited.code, 'rate_limit');

console.log('errorMessages.client.test OK');
