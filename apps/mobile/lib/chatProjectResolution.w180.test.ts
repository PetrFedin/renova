import { readFileSync } from 'node:fs';

function must(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const route = readFileSync('apps/mobile/app/chat/[threadId].tsx', 'utf8');
const helper = readFileSync('apps/mobile/lib/chatProjectResolution.ts', 'utf8');
const threadView = readFileSync('apps/mobile/components/renova/chat/ChatThreadView.tsx', 'utf8');

must(
  route.includes('resolveChatProjectId({'),
  'chat route must resolve and validate project/thread access before mounting the thread UI',
);
must(
  route.includes('projectId={resolvedProjectId}'),
  'ChatThreadView must receive only a resolved project id',
);
must(
  route.includes('key={`${threadId}:${resolvedProjectId}`}'),
  'thread/project changes must remount the chat view so stale state cannot leak across routes',
);
must(
  route.includes("reportError('chat.route.resolveProject'"),
  'chat project-resolution failures must remain observable',
);
must(
  route.includes('title="Повторить"'),
  'resolution failures must expose a retry path instead of an infinite loading dead end',
);
must(
  !route.includes('projectId={projectId}'),
  'unvalidated deep-link project ids must never be passed directly into ChatThreadView',
);
must(
  helper.includes('if (!isChatProjectMiss(error)) throw error;'),
  'only the explicit backend project/thread miss may fall back to inbox lookup',
);
must(
  helper.includes('await api.getChat(userId, found.project_id, threadId);'),
  'an inbox-derived project id must be validated again before use',
);
must(
  !helper.includes('candidateProjectId ??'),
  'resolver must not fabricate a project fallback after a failed ACL read',
);

must(
  threadView.includes('projectId: string;'),
  'ChatThreadView must require the route-resolved project id',
);
must(
  !threadView.includes('resolveProjectId'),
  'ChatThreadView must not duplicate route-level project ownership resolution',
);
must(
  threadView.includes("reportError('chat.markRead.sync', error, { threadId, projectId, cursor })"),
  'cursor read reconciliation failures must remain observable',
);
const readSyncIndex = threadView.indexOf('await syncAfterRead(projectId, threadId, cursor);');
const markSuccessIndex = threadView.indexOf('markedCursorRef.current = markKey;', readSyncIndex);
const readSyncFailureIndex = threadView.indexOf("reportError('chat.markRead.sync'", readSyncIndex);
must(readSyncIndex >= 0, 'ChatThreadView must synchronize the explicit read cursor before memoizing success');
must(markSuccessIndex > readSyncIndex, 'read success may be memoized only after syncAfterRead resolves');
must(readSyncFailureIndex > markSuccessIndex, 'read sync failure handling must follow the success assignment');
const failureBlock = threadView.slice(readSyncFailureIndex, threadView.indexOf('\n    }', readSyncFailureIndex));
must(
  !failureBlock.includes('markedCursorRef.current = markKey'),
  'failed cursor reconciliation must not suppress the next retry',
);
must(
  threadView.includes('requestAnimationFrame'),
  'read cursor must not be emitted before the loaded transcript receives a render frame',
);
must(
  threadView.includes("AppState.currentState !== 'active'"),
  'background app state must not emit a read cursor',
);
must(
  threadView.includes('overlayBlocking'),
  'blocking sheets/modals must prevent read receipt emission',
);

console.log('chatProjectResolution.w180.test OK');