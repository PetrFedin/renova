/** Разбор кадров WS чата (COM-026): что делать экрану с входящим кадром. */

export type ChatWsFrame = { type?: string; message?: unknown; message_id?: unknown; [key: string]: unknown };
export type ChatFrameAction = 'typing' | 'reload' | 'ignore';

/** Кадры, меняющие содержимое треда → перезагрузить окно. */
const RELOAD_TYPES = new Set([
  'message',
  'message_new',
  'message_updated',
  'message_edited',
  'message_deleted',
  'message_pinned',
  'message_confirmed',
  'reaction',
  'pin',
  'confirm',
  'confirmed',
  'edit',
  'edited',
  'delete',
  'deleted',
  'read',
  'read_receipt',
  'thread_updated',
  'thread_state',
  'participant_added',
  'participant_removed',
  'participant_updated',
]);

/**
 * `typing` — индикатор; известные типы — перезагрузка; кадр без `type`, но с `message`/`message_id`
 * (сервер добавил новый тип) — тоже перезагрузка; всё остальное (inbox, ping, неизвестные) игнорируется.
 */
export function classifyChatFrame(payload: ChatWsFrame | null | undefined): ChatFrameAction {
  if (!payload || typeof payload !== 'object') return 'ignore';
  const type = typeof payload.type === 'string' ? payload.type : '';
  if (type === 'typing') return 'typing';
  if (RELOAD_TYPES.has(type)) return 'reload';
  if (type === '' && (payload.message != null || payload.message_id != null)) return 'reload';
  return 'ignore';
}
