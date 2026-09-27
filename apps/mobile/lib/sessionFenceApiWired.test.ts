/**
 * #315 (продолжение): fencing только в `RenovaContext` было недостаточным.
 * `api/client.ts::authHeaders()` игнорировал переданный `userId`, пока
 * `_accessToken` был выставлен — офлайн-задание аккаунта A или запоздалый
 * вызов экрана уходили с текущим глобальным Bearer, даже если он уже
 * принадлежал аккаунту B. `refreshAccessToken()` публиковал результат без
 * проверки, что сессия не сменилась за время запроса. `offlineQueue.ts`
 * отправлял задания без сверки владельца с активной сессией.
 *
 * Эти проверки читают исходники напрямую: раньше в этих файлах не было ни
 * одного упоминания рубежа сессии, значит их некому было проверить.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = __dirname;
const client = readFileSync(join(mobile, 'api', 'client.ts'), 'utf8');
const queue = readFileSync(join(mobile, 'offlineQueue.ts'), 'utf8');
const authority = readFileSync(join(mobile, 'domain', 'sessionAuthority.ts'), 'utf8');

function must(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

must(authority.includes('export function currentSessionUserId'), 'sessionAuthority must expose currentSessionUserId');
must(authority.includes('export function getSessionStamp'), 'sessionAuthority must expose getSessionStamp');
must(authority.includes('export function beginSessionAuthority'), 'sessionAuthority must expose beginSessionAuthority');

// authHeaders: чужой/устаревший userId не получает текущий глобальный Bearer.
{
  const start = client.indexOf('export function authHeaders');
  must(start !== -1, 'authHeaders not found');
  const end = client.indexOf('\nexport ', start + 1);
  const body = client.slice(start, end === -1 ? undefined : end);
  must(body.includes("from '@/lib/domain/sessionAuthority'") || client.includes("import { currentSessionUserId"), 'authHeaders module must import currentSessionUserId');
  must(body.includes('currentSessionUserId()'), 'authHeaders must consult the shared session authority');
  const guardIdx = body.indexOf('userId !== currentSessionUserId()');
  const authIdx = body.indexOf('h.Authorization = `Bearer ${_accessToken}`;');
  must(guardIdx !== -1, 'authHeaders must reject a userId that does not match the active session');
  must(guardIdx < authIdx, 'the session-mismatch guard must run before the Bearer is attached');
}

// refreshAccessToken: метка снята один раз, до await, и сверена перед публикацией.
{
  const start = client.indexOf('export async function refreshAccessToken');
  must(start !== -1, 'refreshAccessToken not found');
  const end = client.indexOf('\nexport ', start + 1);
  const body = client.slice(start, end === -1 ? undefined : end);
  must(body.includes('const stampAtStart = getSessionStamp();'), 'refreshAccessToken must snapshot the session stamp before the network call');
  must(
    (body.match(/getSessionStamp\(\)\.generation !== stampAtStart\.generation/g) || []).length >= 1,
    'a stale generation must not publish refreshed tokens',
  );
  must(
    body.includes('getSessionStamp().generation === stampAtStart.generation') &&
      body.indexOf('getSessionStamp().generation === stampAtStart.generation') < body.indexOf('setAccessToken(null);'),
    'an authoritative rejection must not clear a newer session’s tokens',
  );
}

// offlineQueue: задание другого/устаревшего владельца не отправляется вовсе.
{
  must(queue.includes("from '@/lib/domain/sessionAuthority'"), 'offlineQueue must import the shared session authority');
  const flushStart = queue.indexOf('async function flushOnce');
  must(flushStart !== -1, 'flushOnce not found');
  const loopStart = queue.indexOf('for (const job of sorted)', flushStart);
  const fetchIdx = queue.indexOf('fetchWithTimeout(', loopStart);
  const guardIdx = queue.indexOf("job.userId !== currentSessionUserId()", loopStart);
  must(guardIdx !== -1 && guardIdx < fetchIdx, 'a job whose owner is not the active session must be skipped before it is ever sent');
}

console.log('sessionFenceApiWired.test OK');
