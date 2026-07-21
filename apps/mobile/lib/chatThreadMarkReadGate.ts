/**
 * Условия mark-read после render commit (без setTimeout).
 * Вынесено для unit-тестов реального lifecycle-контракта ChatThreadView.
 */
export type MarkReadGateInput = {
  threadId: string;
  chatId?: string | null;
  messagesReady: boolean;
  loadFailed: boolean;
  isFocused: boolean;
  appState: 'active' | 'background' | 'inactive' | string;
  /** Сообщения уже в state (после commit) */
  hasMessagesArray: boolean;
};

export function shouldMarkThreadReadAfterCommit(input: MarkReadGateInput): boolean {
  if (!input.chatId || input.chatId !== input.threadId) return false;
  if (!input.messagesReady || input.loadFailed) return false;
  if (!input.isFocused || input.appState !== 'active') return false;
  if (!input.hasMessagesArray) return false;
  return true;
}
