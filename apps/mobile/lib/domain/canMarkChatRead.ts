/**
 * Gate: чат отмечается прочитанным только когда пользователь реально видит тред.
 * Mark-read вызывается лишь на переходе canMarkRead: false → true.
 *
 * Делегирует в screenVisibility — единый контракт с useScreenVisibility.
 */
import {
  evaluateMarkReadAllowed,
} from './screenVisibility';

export type ChatReadGateInput = {
  screenFocused: boolean;
  /** AppState === 'active' (+ web document visible) */
  appForeground: boolean;
  threadLoaded: boolean;
  accessConfirmed: boolean;
  latestMessagesRendered: boolean;
  /** 403/404/network/load error — нельзя mark-read */
  loadFailed?: boolean;
  /** Активный threadId совпадает с загруженным */
  threadMatches?: boolean;
  /** Modal/invite поверх ленты */
  overlayBlocking?: boolean;
  loggedIn?: boolean;
  mounted?: boolean;
};

export function evaluateCanMarkChatRead(input: ChatReadGateInput): boolean {
  if (input.loadFailed) return false;
  return evaluateMarkReadAllowed({
    appForeground: input.appForeground,
    screenFocused: input.screenFocused,
    threadIdMatches: input.threadMatches !== false,
    loggedIn: input.loggedIn !== false,
    overlayBlocking: Boolean(input.overlayBlocking),
    threadContentReady: Boolean(
      input.threadLoaded
      && input.accessConfirmed
      && input.latestMessagesRendered,
    ),
    mounted: input.mounted !== false,
  });
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
