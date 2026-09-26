/**
 * Реестр офлайн-очередей записи — инвентарь из #316.
 *
 * Каждая очередь разобрана отдельно, как требует issue: скопом их нельзя
 * считать ни безопасными, ни опасными. Реестр сверяется с исходниками
 * тестом, поэтому разойтись с действительностью молча он не может.
 *
 * identity     — тело несёт `client_request_id`, повтор узнаёт сервер;
 * transition   — пустое тело, повтор гасит машина состояний;
 * non-create   — PATCH/PUT/DELETE: повтор переписывает ту же строку,
 *                второй сущности не появляется;
 * unprotected  — POST с телом без ключа: повтор после потери ответа
 *                может создать дубль. Это остаток работы по #316.
 */
import type { QueuedWriteKind } from './queuedWrites';

export const QUEUED_WRITE_REGISTRY: Record<string, QueuedWriteKind> = {
  'DELETE /api/v1/projects/:param/os/expenses/:param': 'non-create',
  'DELETE /api/v1/projects/:param/receipts/:param': 'non-create',
  'DELETE /api/v1/projects/:param/scratchpad/:param': 'non-create',
  'PATCH /api/v1/projects/:param/calendar/stages': 'non-create',
  'PATCH /api/v1/projects/:param/chats/:param/state': 'non-create',
  'PATCH /api/v1/projects/:param/estimate/lines/:param': 'non-create',
  'PATCH /api/v1/projects/:param/floor-plans/:param/pins/:param': 'non-create',
  'PATCH /api/v1/projects/:param/furniture/:param': 'non-create',
  'PATCH /api/v1/projects/:param/os/expenses/:param': 'non-create',
  'PATCH /api/v1/projects/:param/receipts/:param': 'non-create',
  'PATCH /api/v1/projects/:param/rooms/:param': 'non-create',
  'PATCH /api/v1/projects/:param/scratchpad/:param': 'non-create',
  'PATCH /api/v1/projects/:param/stages/:param/depends': 'non-create',
  'PATCH /api/v1/projects/:param/stages/:param/rooms': 'non-create',
  'PATCH /api/v1/projects/:param/stages/:param/work-type': 'non-create',
  'PATCH /api/v1/projects/:param/work-orders/:param': 'non-create',
  'POST /api/v1/projects/:param/approvals/:param/approve': 'unprotected',
  'POST /api/v1/projects/:param/approvals/:param/reject': 'unprotected',
  'POST /api/v1/projects/:param/calendar/import': 'unprotected',
  'POST /api/v1/projects/:param/change-orders': 'identity',
  'POST /api/v1/projects/:param/change-orders/:param/approve': 'transition',
  'POST /api/v1/projects/:param/change-orders/:param/reject': 'transition',
  'POST /api/v1/projects/:param/chats': 'unprotected',
  'POST /api/v1/projects/:param/chats/:param/invoice': 'unprotected',
  'POST /api/v1/projects/:param/chats/:param/messages': 'identity',
  'POST /api/v1/projects/:param/chats/:param/messages/:param/confirm': 'transition',
  'POST /api/v1/projects/:param/chats/:param/messages/:param/pin?pin=:param': 'transition',
  'POST /api/v1/projects/:param/chats/:param/messages/:param/react': 'unprotected',
  'POST /api/v1/projects/:param/chats/:param/messages/:param/task': 'unprotected',
  'POST /api/v1/projects/:param/chats/:param/read': 'unprotected',
  'POST /api/v1/projects/:param/design-packages': 'unprotected',
  'POST /api/v1/projects/:param/design-packages/:param/approve': 'transition',
  'POST /api/v1/projects/:param/design-packages/:param/submit': 'transition',
  'POST /api/v1/projects/:param/documents': 'unprotected',
  'POST /api/v1/projects/:param/documents/:param/archive': 'transition',
  'POST /api/v1/projects/:param/documents/:param/sign': 'unprotected',
  'POST /api/v1/projects/:param/estimate/lines': 'unprotected',
  'POST /api/v1/projects/:param/estimate/lock': 'transition',
  'POST /api/v1/projects/:param/estimate/propose-lock': 'transition',
  'POST /api/v1/projects/:param/estimate/reject-lock': 'unprotected',
  'POST /api/v1/projects/:param/estimate/withdraw-lock': 'unprotected',
  'POST /api/v1/projects/:param/material-needs/from-estimate': 'transition',
  'POST /api/v1/projects/:param/material-picks': 'identity',
  'POST /api/v1/projects/:param/material-picks/:param/approve': 'transition',
  'POST /api/v1/projects/:param/material-picks/:param/reject': 'unprotected',
  'POST /api/v1/projects/:param/material-picks/:param/submit': 'transition',
  'POST /api/v1/projects/:param/payments/:param/confirm': 'unprotected',
  'POST /api/v1/projects/:param/purchases': 'identity',
  'POST /api/v1/projects/:param/purchases/:param/status': 'unprotected',
  'POST /api/v1/projects/:param/receipts/manual': 'identity',
  'POST /api/v1/projects/:param/receipts/scan': 'identity',
  'POST /api/v1/projects/:param/room-change-requests': 'unprotected',
  'POST /api/v1/projects/:param/room-change-requests/:param/approve': 'transition',
  'POST /api/v1/projects/:param/room-change-requests/:param/reject': 'transition',
  'POST /api/v1/projects/:param/rooms': 'unprotected',
  'POST /api/v1/projects/:param/scratchpad': 'unprotected',
  'POST /api/v1/projects/:param/stages': 'unprotected',
  'POST /api/v1/projects/:param/stages/:param/checklist/toggle': 'unprotected',
  'POST /api/v1/projects/:param/stages/:param/comments': 'unprotected',
  'POST /api/v1/projects/:param/stages/:param/photos': 'unprotected',
  'POST /api/v1/projects/:param/stages/:param/ready': 'transition',
  'POST /api/v1/projects/:param/stages/:param/start': 'transition',
  'POST /api/v1/projects/:param/warranty-claims': 'identity',
  'POST /api/v1/projects/:param/warranty-claims/:param/close': 'unprotected',
  'POST /api/v1/projects/:param/waste-orders': 'unprotected',
  'POST /api/v1/projects/:param/waste-orders/:param/approve': 'transition',
  'POST /api/v1/projects/:param/waste-orders/:param/complete': 'transition',
  'POST /api/v1/projects/:param/waste-orders/:param/request': 'transition',
  'POST /api/v1/projects/:param/work-acceptances': 'unprotected',
  'POST /api/v1/projects/:param/work-acceptances/:param/accept': 'unprotected',
  'POST /api/v1/projects/:param/work-acceptances/:param/return': 'unprotected',
  'POST /api/v1/projects/:param/work-orders': 'unprotected',
  'POST /api/v1/projects/:param/work-orders/:param/transition': 'unprotected',
  'POST /api/v1/projects/:param/work-schedules': 'unprotected',
  'POST /api/v1/projects/:param/work-schedules/:param/confirm': 'transition',
  'POST /api/v1/projects/:param/work-schedules/:param/items/:param/status': 'unprotected',
  'POST /api/v1/projects/:param/work-schedules/:param/reject': 'unprotected',
  'POST /api/v1/projects/:param/work-schedules/:param/submit': 'transition',
};

/** Сколько очередей ещё без ключа запроса — снижается по мере закрытия #316. */
export const UNPROTECTED_QUEUED_WRITES = 34;
