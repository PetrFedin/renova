/** Чаты проекта */
export type ChatMessage = {
  id: string;
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
};

export type ChatDetail = ChatThread & { messages: ChatMessage[]; participants?: ChatParticipant[] };

/**
 * Контракт структурированных inbox-счётчиков (API v1).
 * Сообщения и action-категории никогда не складываются в одно UI-число.
 */
export type InboxCountersResponseV1 = {
  unread_messages: number;
  active_tasks: number;
  pending_approvals: number;
  payment_actions: number;
  quality_actions: number;
  total_action_groups: number;
  /** @deprecated сумма разных единиц — не использовать на клиенте */
  count?: number;
};
