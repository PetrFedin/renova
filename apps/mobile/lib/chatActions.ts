/**
 * Действия над сообщением и тредом чата (COM-006, COM-028): кто что может.
 * Чистые функции — зеркало правил backend (chat_message_mutation.py, chat_service.can_manage_thread);
 * сервер остаётся источником истины, а экран лишь не показывает заведомо запрещённые кнопки.
 */
import type { ChatMessage, ChatParticipant } from '@/lib/api/types/chat';

/** Окно правки на сервере: EDIT_WINDOW = 24 ч от создания сообщения. */
export const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

type MessageLike = Pick<ChatMessage, 'author_id' | 'author_role' | 'message_type' | 'created_at'> & {
  deleted?: boolean | null;
  edited_at?: string | null;
};

/** Время с сервера приходит без зоны (UTC) — без «Z» браузер прочёл бы его как местное. */
export function parseChatTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const t = Date.parse(hasZone ? value : `${value}Z`);
  return Number.isFinite(t) ? t : null;
}

/** Своё ли сообщение (строго по id автора; без id — по роли, как isMineMessage). */
function isMine(m: MessageLike, user: { id: string; role?: string | null }): boolean {
  if (m.author_id) return m.author_id === user.id;
  return !!m.author_role && m.author_role === user.role;
}

/** Правка текстового сообщения возможна, пока с создания прошло не больше 24 ч. */
export function canEditByAge(createdAt: string, now: number = Date.now()): boolean {
  const t = parseChatTime(createdAt);
  if (t == null) return false;
  return now - t <= EDIT_WINDOW_MS;
}

export function isDeletedMessage(m: { deleted?: boolean | null }): boolean {
  return m.deleted === true;
}

/** Подпись «изменено» (null — не менялось или удалено). */
export function editedLabel(m: { edited_at?: string | null; deleted?: boolean | null }): string | null {
  if (isDeletedMessage(m)) return null;
  return m.edited_at ? 'изменено' : null;
}

export type MessageActions = {
  reply: boolean;
  pin: boolean;
  edit: boolean;
  remove: boolean;
};

export type ThreadActionContext = {
  /** Закрепление сообщений доступно участникам проекта с правом записи. */
  canPin: boolean;
  /** Режим «только чтение» у пользователя. */
  canWrite?: boolean;
};

/**
 * Какие действия показывать у сообщения. Редактировать — только своё текстовое моложе 24 ч;
 * удалить — своё (без срока); удалённому и системному действия не нужны.
 */
export function messageActions(
  message: MessageLike,
  user: { id: string; role?: string | null },
  thread: ThreadActionContext,
  now: number = Date.now(),
): MessageActions {
  const none: MessageActions = { reply: false, pin: false, edit: false, remove: false };
  if (isDeletedMessage(message)) return none;
  if (message.author_role === 'system' || message.message_type === 'system') return none;
  const writable = thread.canWrite !== false;
  const mine = isMine(message, user);
  return {
    reply: writable,
    pin: thread.canPin,
    edit: writable && mine && message.message_type === 'text' && canEditByAge(message.created_at, now),
    remove: writable && mine,
  };
}

type ParticipantLike = Pick<ChatParticipant, 'user_id' | 'status'> & { role?: string | null };

/** Тред переименовывает и архивирует создатель либо заказчик объекта. */
export function canManageThread(
  user: { id: string },
  participants: ParticipantLike[] | undefined,
  messages: Array<Pick<ChatMessage, 'author_id' | 'author_role' | 'message_type'>>,
): boolean {
  if ((participants ?? []).some((p) => p.user_id === user.id && p.role === 'customer')) return true;
  // Первое системное сообщение «Чат создан» написано от имени создателя.
  const creation = messages.find((m) => m.author_role === 'system' || m.message_type === 'system');
  return !!creation && creation.author_id === user.id;
}

/** Выйти может приглашённый участник; участники проекта (заказчик, исполнитель, команда) — нет. */
export function canLeaveThread(user: { id: string }, participants: ParticipantLike[] | undefined): boolean {
  return (participants ?? []).some((p) => p.user_id === user.id && p.role === 'invited' && p.status === 'active');
}

/** Убрать можно только приглашённого (не себя); участники проекта убираются из команды проекта. */
export function canRemoveParticipant(
  manager: boolean,
  user: { id: string },
  p: ParticipantLike,
): boolean {
  return manager && p.role === 'invited' && p.user_id !== user.id && p.status !== 'removed' && p.status !== 'left';
}

const ROLE_LABELS: Record<string, string> = {
  customer: 'заказчик',
  contractor: 'исполнитель',
  invited: 'приглашён',
  team_foreman: 'бригада',
  team_worker: 'бригада',
  team_manager: 'бригада',
};

export function participantRoleLabel(role: string | null | undefined): string {
  if (!role) return '';
  return ROLE_LABELS[role] ?? (role.startsWith('team_') ? 'бригада' : '');
}

const CODE_TEXT: Record<string, string> = {
  only_author_can_edit_message: 'Править можно только своё сообщение.',
  edit_window_expired: 'Сообщение можно изменить только в течение суток после отправки.',
  message_type_not_editable: 'Изменить можно только текстовое сообщение.',
  message_deleted: 'Сообщение уже удалено.',
  invalid_message_text: 'Текст сообщения не должен быть пустым или длиннее 8000 знаков.',
  only_author_can_delete_message: 'Удалить можно только своё сообщение.',
  only_creator_or_customer_can_manage_thread: 'Чатом управляет его создатель или заказчик объекта.',
  empty_title: 'Название чата не может быть пустым.',
  project_member_cannot_leave_thread: 'Участник объекта не может выйти из чата. Выйти могут только приглашённые.',
  not_a_thread_participant: 'Вы не состоите в этом чате.',
  participant_not_found: 'Участник уже убран из чата.',
  message_not_found: 'Сообщение не найдено — возможно, оно уже удалено.',
  chat_not_found: 'Чат не найден.',
};

/** Понятная причина для 403/409/422 и известных кодов; null — пусть решает общий разбор ошибки. */
export function chatMutationError(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as { message?: unknown; code?: unknown; status?: unknown };
  const msg = typeof e.message === 'string' ? e.message.trim() : '';
  const code = typeof e.code === 'string' ? e.code : '';
  if (msg && CODE_TEXT[msg]) return CODE_TEXT[msg];
  if (code && CODE_TEXT[code]) return CODE_TEXT[code];
  if (e.status === 403) return 'Недостаточно прав для этого действия.';
  if (e.status === 409) return 'Действие сейчас недоступно: данные изменились. Обновите чат и повторите.';
  if (e.status === 422) return 'Проверьте введённые данные и повторите.';
  return null;
}
