/** Выход должен отзывать refresh-сессию на сервере до очистки локальных токенов. */
process.env.EXPO_PUBLIC_API_URL ||= 'http://127.0.0.1:8100';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const must = (c: boolean, m: string) => {
  if (!c) throw new Error(m);
};

async function main() {
  const { authApi } = await import('./auth');
  const calls: { url: string; init: any }[] = [];
  let status = 200;
  (globalThis as any).fetch = async (url: string, init: any) => {
    calls.push({ url, init });
    return { ok: status < 400, status, text: async () => '{}' };
  };

  await authApi.logout('rt-1');
  must(calls.length === 1, 'one call');
  must(calls[0].url.endsWith('/api/v1/auth/logout'), 'url');
  must(calls[0].init.method === 'POST', 'POST');
  must(JSON.parse(calls[0].init.body).refresh_token === 'rt-1', 'body carries refresh token');
  must(!('Authorization' in calls[0].init.headers), 'no bearer');

  status = 500;
  let threw = false;
  try { await authApi.logout('rt-1'); } catch { threw = true; }
  must(threw, 'HTTP error surfaces to caller');

  (globalThis as any).fetch = async () => { throw new TypeError('Network request failed'); };
  threw = false;
  try { await authApi.logout('rt-1'); } catch { threw = true; }
  must(threw, 'network error surfaces to caller');

  // Проводка в контексте: отзыв раньше очистки, ошибка репортится, фенс проверяется.
  const src = readFileSync(join(__dirname, '../context/RenovaContext.tsx'), 'utf8');
  const start = src.indexOf('const logout = useCallback');
  const body = src.slice(start, src.indexOf('}, []);', start));
  const iRevoke = body.indexOf('api.logout(');
  const iClear = body.indexOf('AsyncStorage.multiRemove');
  must(iRevoke > 0 && iClear > iRevoke, 'server revoke precedes local clear');
  must(body.includes("reportError('renovaContext.logoutRevoke'"), 'revoke failure reported');
  must(body.includes('getSessionStamp().generation !== stamp.generation'), 'session fence checked');
  console.log('logoutRevoke tests OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
