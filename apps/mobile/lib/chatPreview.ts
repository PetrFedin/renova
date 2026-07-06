/** Превью и сортировка чатов — без системного шума «Чат создан» */
import type { ChatMessage, ChatThread } from '@/lib/api';

const CREATED_RE = /^Чат «.+» создан$/;

export function isChatCreationSystemMessage(msg: ChatMessage | null | undefined): boolean {
  if (!msg) return false;
  if (msg.message_type === 'system' || msg.author_role === 'system') {
    const text = (msg.text || '').trim();
    return CREATED_RE.test(text) || text.startsWith('Чат «');
  }
  return false;
}

/** Текст для строки списка — пропускаем системное «чат создан» */
export function chatListPreview(thread: ChatThread): string {
  const last = thread.last_message;
  if (!last?.text?.trim()) return 'Нет сообщений';
  if (isChatCreationSystemMessage(last)) return 'Новый чат';
  if (last.message_type === 'photo' || last.text === 'Фото') return '📷 Фото';
  if (last.message_type === 'file') return last.file_name ? `📎 ${last.file_name}` : '📎 Файл';
  if (last.message_type === 'confirm') return '✓ Запрос подтверждения';
  if (last.message_type === 'payment') return '💳 Запрос оплаты';
  return last.text.trim();
}

export function sortChatThreads(list: ChatThread[]): ChatThread[] {
  return [...list].sort((a, b) => {
    const pinA = a.is_pinned ? 1 : 0;
    const pinB = b.is_pinned ? 1 : 0;
    if (pinA !== pinB) return pinB - pinA;
    return b.updated_at.localeCompare(a.updated_at);
  });
}

export function findExistingChat(
  threads: ChatThread[],
  projectId: string,
  title: string,
  topic?: string,
): ChatThread | undefined {
  const norm = title.trim().toLowerCase();
  if (topic) {
    const byTopic = threads.find(
      (t) => t.project_id === projectId && !t.is_archived && t.topic === topic,
    );
    if (byTopic) return byTopic;
  }
  if (!norm) return undefined;
  return threads.find(
    (t) =>
      t.project_id === projectId
      && !t.is_archived
      && t.title.trim().toLowerCase() === norm,
  );
}
