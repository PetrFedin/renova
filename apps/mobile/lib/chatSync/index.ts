/**
 * Singleton chat sync + привязка к inboxSyncStore.
 * UI вызывает только requestChatSync / setChatSyncContext — не reloadInboxSync напрямую.
 */
import { ChatSyncOrchestrator } from './orchestrator';
import type {
  ChatSyncContext,
  ChatSyncMetrics,
  ChatSyncOutcome,
  ChatSyncRequest,
  ChatSyncTransport,
  ChatSyncTransportArgs,
} from './types';

export type { ChatSyncContext, ChatSyncMetrics, ChatSyncOutcome, ChatSyncRequest };
export { ChatSyncOrchestrator } from './orchestrator';
export { buildChatSyncContextKey } from './contextKey';

type ThreadLoader = (args: ChatSyncTransportArgs & { threadId: string }) => Promise<void>;

const threadLoaders = new Map<string, ThreadLoader>();

/** ChatThreadView регистрирует загрузчик сообщений на время монтирования */
export function registerThreadSyncLoader(threadId: string, loader: ThreadLoader): () => void {
  threadLoaders.set(threadId, loader);
  return () => {
    if (threadLoaders.get(threadId) === loader) {
      threadLoaders.delete(threadId);
    }
  };
}

let transportBound = false;

async function defaultSyncAll(args: ChatSyncTransportArgs): Promise<void> {
  const { reloadInboxSync } = await import('@/lib/inboxSyncStore');
  await reloadInboxSync(
    {
      userId: args.userId,
      userRole: (args.role as 'customer' | 'contractor' | undefined) ?? undefined,
      projectId: args.projectId ?? undefined,
      osRole: args.role === 'contractor' ? 'contractor' : args.role === 'customer' ? 'customer' : undefined,
    },
    args.reason === 'manual'
      || args.reason === 'offline_flush'
      || args.reason === 'reconnect'
      || args.reason === 'project_change',
    {
      signal: args.signal,
      contextKey: args.contextKey,
      getContextKey: () => chatSync.getContextKey(),
    },
  );
}

async function defaultSyncThread(args: ChatSyncTransportArgs & { threadId: string }): Promise<void> {
  const loader = threadLoaders.get(args.threadId);
  if (!loader) {
    // Нет открытого треда — inbox reconciliation достаточно
    await defaultSyncAll(args);
    return;
  }
  await loader(args);
}

const defaultTransport: ChatSyncTransport = {
  syncAll: defaultSyncAll,
  syncThread: defaultSyncThread,
};

/** Глобальный оркестратор (web: BroadcastChannel между вкладками) */
export const chatSync = new ChatSyncOrchestrator({
  transport: defaultTransport,
  enableBroadcast: typeof BroadcastChannel !== 'undefined',
});

export function bindChatSyncTransport(transport: ChatSyncTransport): void {
  chatSync.setTransport(transport);
  transportBound = true;
}

export function ensureChatSyncTransportBound(): void {
  if (!transportBound) {
    chatSync.setTransport(defaultTransport);
    transportBound = true;
  }
}

export function setChatSyncContext(ctx: ChatSyncContext): void {
  ensureChatSyncTransportBound();
  chatSync.setContext(ctx);
}

/** Частичное обновление контекста — не затирает projectId из другого хука */
export function patchChatSyncContext(patch: Partial<ChatSyncContext>): void {
  ensureChatSyncTransportBound();
  const cur = chatSync.getContext();
  chatSync.setContext({
    userId: patch.userId !== undefined ? patch.userId : cur.userId,
    role: patch.role !== undefined ? patch.role : cur.role,
    projectId: patch.projectId !== undefined ? patch.projectId : cur.projectId,
  });
}

export function requestChatSync(req: ChatSyncRequest): Promise<ChatSyncOutcome> {
  ensureChatSyncTransportBound();
  return chatSync.requestSync(req);
}

export function onChatInboxWsEvent(): void {
  ensureChatSyncTransportBound();
  chatSync.onInboxWsEvent();
}

export function setChatInboxWsConnected(connected: boolean): void {
  ensureChatSyncTransportBound();
  chatSync.setInboxWsConnected(connected);
}

export function reconcileChatAfterOfflineFlush(): Promise<ChatSyncOutcome> {
  ensureChatSyncTransportBound();
  return chatSync.reconcileAfterOfflineFlush();
}

export function getChatSyncMetrics(): ChatSyncMetrics {
  return chatSync.getMetrics();
}

export function logoutChatSync(): void {
  chatSync.logout();
}
