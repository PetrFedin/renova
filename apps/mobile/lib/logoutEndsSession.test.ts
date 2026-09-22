/**
 * Выход обязан гасить сессию на сервере. Раньше он чистил только локальное
 * хранилище: refresh-токен оставался живым до срока, а отозвать его было уже
 * нечем — токен стирался вместе с остальным.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(mobile, rel), 'utf8');

const authSrc = src('lib/api/auth.ts');
const context = src('lib/context/RenovaContext.tsx');

if (!authSrc.includes('logoutSession')) throw new Error('нет клиентского закрытия сессии');
if (!authSrc.includes("'/api/v1/auth/logout'")) throw new Error('выход бьёт не в ту ручку');
if (!authSrc.includes('refresh_token: refreshToken')) throw new Error('сервер не получает токен для отзыва');

const logout = context.split('const logout = useCallback')[1]?.split('const value = useMemo')[0] ?? '';
if (!logout) throw new Error('не удалось найти выход в контексте');
if (!logout.includes('api.logoutSession(refreshToken)')) {
  throw new Error('выход не закрывает сессию на сервере');
}

const revokeAt = logout.indexOf('api.logoutSession');
const clearAt = logout.indexOf('AsyncStorage.multiRemove');
if (revokeAt < 0 || clearAt < 0 || revokeAt > clearAt) {
  throw new Error('очистка хранилища идёт раньше отзыва — отзывать будет нечем');
}
if (!/catch \(error\) \{\s*reportError\('lib\.context\.RenovaContext\.logoutRevoke'/.test(logout)) {
  throw new Error('сбой отзыва проглочен молча');
}
if (!/if \(refreshToken\) \{/.test(logout)) {
  throw new Error('выход без токена должен обходиться без запроса');
}
const failurePath = logout.slice(logout.indexOf('catch (error)'));
if (!failurePath.includes('AsyncStorage.multiRemove')) {
  throw new Error('неудача отзыва не должна отменять выход с устройства');
}

console.log('logoutEndsSession.test OK');
