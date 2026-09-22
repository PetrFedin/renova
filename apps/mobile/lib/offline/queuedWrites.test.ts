import { classifyQueuedWrite, normalizeQueuedPath, parseQueuedWrites, queuedWriteKey } from './queuedWrites';

if (normalizeQueuedPath('/api/v1/projects/${projectId}/stages/${id}') !== '/api/v1/projects/:param/stages/:param') {
  throw new Error('подстановки не нормализуются');
}
if (normalizeQueuedPath('/api/v1/chats/inbox') !== '/api/v1/chats/inbox') throw new Error('путь без подстановок');

const id = { method: 'POST', body: 'serialized', hasIdentityNearby: true } as const;
if (classifyQueuedWrite(id) !== 'identity') throw new Error('ключ — сильнейший признак');
if (classifyQueuedWrite({ method: 'POST', body: "'{}'", hasIdentityNearby: false }) !== 'transition') {
  throw new Error('пустое тело — переход состояния');
}
if (classifyQueuedWrite({ method: 'POST', body: 'serialized', hasIdentityNearby: false }) !== 'unprotected') {
  throw new Error('POST с телом и без ключа — незащищён');
}
if (classifyQueuedWrite({ method: 'PATCH', body: 'serialized', hasIdentityNearby: false }) !== 'non-create') {
  throw new Error('PATCH не создаёт вторую сущность');
}
if (classifyQueuedWrite({ method: 'DELETE', body: "'{}'", hasIdentityNearby: false }) !== 'non-create') {
  throw new Error('DELETE не создаёт вторую сущность');
}

const source = [
  "export const api = {",
  "  createThing: async (userId: string, projectId: string, body: object) => {",
  "    const serialized = JSON.stringify({ ...body, client_request_id: 'x' });",
  "    try { return await req(`/api/v1/projects/${projectId}/things`, { method: 'POST', body: serialized }, userId); }",
  "    catch (e) {",
  "      await enqueue({ path: `/api/v1/projects/${projectId}/things`, method: 'POST', body: serialized, userId });",
  "      throw new Error('offline_queued');",
  "    }",
  "  },",
  "  submitThing: async (userId: string, projectId: string, id: string) => {",
  "    try { return await req(`/api/v1/projects/${projectId}/things/${id}/submit`, { method: 'POST' }, userId); }",
  "    catch (e) {",
  "      await enqueue({ path: `/api/v1/projects/${projectId}/things/${id}/submit`, method: 'POST', body: '{}', userId });",
  "      throw new Error('offline_queued');",
  "    }",
  "  },",
  "};",
].join('\n');

const parsed = parseQueuedWrites('things.ts', source);
if (parsed.length !== 2) throw new Error(`разобрано очередей: ${parsed.length}`);
if (parsed[0].apiMethod !== 'createThing' || parsed[0].kind !== 'identity') {
  throw new Error(`первая очередь: ${parsed[0].apiMethod}/${parsed[0].kind}`);
}
if (parsed[1].apiMethod !== 'submitThing' || parsed[1].kind !== 'transition') {
  throw new Error(`вторая очередь: ${parsed[1].apiMethod}/${parsed[1].kind}`);
}
if (queuedWriteKey(parsed[0]) !== 'POST /api/v1/projects/:param/things') {
  throw new Error(`ключ реестра: ${queuedWriteKey(parsed[0])}`);
}

// Ключ соседнего метода не должен считаться своим.
const neighbour = [
  "export const api = {",
  "  safeOne: async () => {",
  "    const serialized = JSON.stringify({ client_request_id: 'x' });",
  "    await enqueue({ path: `/api/v1/a`, method: 'POST', body: serialized, userId });",
  "  },",
  "  riskyOne: async (body: object) => {",
  "    await enqueue({ path: `/api/v1/b`, method: 'POST', body: JSON.stringify(body), userId });",
  "  },",
  "};",
].join('\n');
const two = parseQueuedWrites('n.ts', neighbour);
if (two[1].kind !== 'unprotected') throw new Error('чужая защита засчитана как своя');

console.log('queuedWrites.test OK');
