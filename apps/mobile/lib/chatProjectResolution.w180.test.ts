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
  threadView.includes('silent-catch-ok: active project is an optimistic ownership probe'),
  'legacy active-project ownership probing must remain explicitly reviewed instead of becoming anonymous silent debt',
);
must(
  threadView.includes("reportError('chat.markRead.sync', error, { threadId, projectId, knownUnread })"),
  'read reconciliation failures must remain observable',
);
const readSyncIndex = threadView.indexOf('await syncAfterRead(projectId, threadId, knownUnread);');
const markSuccessIndex = threadView.indexOf('markedReadRef.current = markKey;', readSyncIndex);
const readSyncFailureIndex = threadView.indexOf("reportError('chat.markRead.sync'", readSyncIndex);
must(readSyncIndex >= 0, 'ChatThreadView must synchronize read state before memoizing success');
must(markSuccessIndex > readSyncIndex, 'read success may be memoized only after syncAfterRead resolves');
must(readSyncFailureIndex > markSuccessIndex, 'read sync failure handling must follow the success assignment');
const failureBlock = threadView.slice(readSyncFailureIndex, threadView.indexOf('\n    }', readSyncFailureIndex));
must(
  !failureBlock.includes('markedReadRef.current = markKey'),
  'failed read reconciliation must not suppress the next retry',
);

console.log('chatProjectResolution.w180.test OK');
