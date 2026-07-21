import type { ChatSyncContext, ChatSyncContextKey } from './types';

/** Стабильный ключ контекста для привязки ответов */
export function buildChatSyncContextKey(ctx: ChatSyncContext): ChatSyncContextKey {
  return `${ctx.userId ?? ''}:${ctx.role ?? ''}:${ctx.projectId ?? ''}`;
}

export function isLoggedInContext(ctx: ChatSyncContext): boolean {
  return Boolean(ctx.userId);
}
