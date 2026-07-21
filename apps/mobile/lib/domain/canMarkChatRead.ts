/**
 * Gate: чат отмечается прочитанным только когда пользователь реально видит тред.
 * Mark-read вызывается лишь на переходе canMarkRead: false → true.
 */

export type ChatReadGateInput = {
  screenFocused: boolean;
  /** AppState === 'active' */
  appForeground: boolean;
  threadLoaded: boolean;
  accessConfirmed: boolean;
  latestMessagesRendered: boolean;
  /** 403/404/network/load error — нельзя mark-read */
  loadFailed?: boolean;
  /** Активный threadId совпадает с загруженным */
  threadMatches?: boolean;
};

export function evaluateCanMarkChatRead(input: ChatReadGateInput): boolean {
  if (input.loadFailed) return false;
  if (input.threadMatches === false) return false;
  return Boolean(
    input.screenFocused
    && input.appForeground
    && input.threadLoaded
    && input.accessConfirmed
    && input.latestMessagesRendered,
  );
}

/** Ребро false→true: только тогда вызываем mark-read */
export function shouldFireMarkRead(prevCanMark: boolean, nextCanMark: boolean): boolean {
  return !prevCanMark && nextCanMark;
}

export type MarkChatReadBody = {
  read_through_message_id?: string | null;
};

export type MarkChatReadResponse = {
  ok: boolean;
  thread_id: string;
  read_through_message_id?: string | null;
  thread_unread_count: number;
  total_unread_count?: number;
  read_at?: string;
};
