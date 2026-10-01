/** Чаты проекта */
export type ChatMessage = {
  id: string;
  /** id автора: «моё» определяется по нему, а не по роли (COM-028). */
  author_id?: string | null;
  /** Имя автора из профиля (без телефона); null — имя не заполнено. */
  author_name?: string | null;
  author_role: string;
  message_type: string;
  text: string | null;
  image_url: string | null;
  created_at: string;
  confirmed?: boolean | null;
  read?: boolean;
  is_pinned?: boolean;
  reply_to_id?: string | null;
  reactions?: Record<string, string[]>;
  work_order_id?: string | null;
  payment_id?: string | null;
  file_name?: string | null;
  assignee_id?: string | null;
  due_at?: string | null;
  /** COM-006: мягкое удаление — text/image_url приходят пустыми. */
  deleted?: boolean;
  deleted_at?: string | null;
  edited_at?: string | null;
};

export type ChatThread = {
  id: string;
  project_id: string;
  title: string;
  topic: string | null;
  updated_at: string;
  last_message: ChatMessage | null;
  unread_count?: number;
  is_pinned?: boolean;
  is_archived?: boolean;
  pinned_at?: string | null;
  project_name?: string;
};

export type ChatParticipant = {
  id: string;
  user_id?: string | null;
  phone?: string | null;
  profile_code?: string | null;
  full_name?: string | null;
  status: string;
  /** customer | contractor | team_* | invited (только приглашённых можно убрать или они могут выйти). */
  role?: string | null;
};

export type ChatCapabilities = {
  access_scope: 'project' | 'thread';
  can_view_project_actions: boolean;
  can_manage_participants: boolean;
  can_create_task: boolean;
  can_create_invoice: boolean;
};

/**
 * Capabilities are optional for rolling deploy compatibility. Consumers must
 * fail closed for project-only actions when the field is absent; the core
 * thread composer remains governed by the chat ACL itself.
 */
export type ChatDetail = ChatThread & {
  messages: ChatMessage[];
  /** Есть более ранние сообщения (грузятся `before=<id первого>`). */
  has_more_before?: boolean;
  /** Окно `around` не доходит до конца истории. */
  has_more_after?: boolean;
  pinned_messages?: ChatMessage[];
  participants?: ChatParticipant[];
  capabilities?: ChatCapabilities;
  /** true, если никто, кроме автора, не получит сообщение (исполнитель ещё не подключён) */
  no_other_recipients?: boolean;
};
