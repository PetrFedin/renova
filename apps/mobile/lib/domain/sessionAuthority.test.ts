/**
 * #315: `sessionAuthority` — общий рубеж между `RenovaContext`, `api/client.ts`
 * и `offlineQueue.ts`. Проверяем поведение самого источника истины: поколение
 * растёт при каждом входе/выходе (даже под тем же человеком), а `userId`
 * снаружи виден только через `currentSessionUserId`.
 */
import {
  __resetSessionAuthorityForTests,
  beginSessionAuthority,
  currentSessionUserId,
  getSessionStamp,
} from './sessionAuthority';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

__resetSessionAuthorityForTests();

assert(getSessionStamp().generation === 0 && currentSessionUserId() === null, 'начальное состояние — никто не вошёл');

const afterA = beginSessionAuthority('user-a');
assert(afterA.generation === 1 && currentSessionUserId() === 'user-a', 'вход A сдвигает поколение и публикует userId');

const afterLogout = beginSessionAuthority(null);
assert(afterLogout.generation === 2 && currentSessionUserId() === null, 'выход сдвигает поколение и обнуляет userId');

const afterB = beginSessionAuthority('user-b');
assert(afterB.generation === 3 && currentSessionUserId() === 'user-b', 'вход B — новое поколение');

// A -> logout -> A: тот же человек, но это не непрерывная сессия.
__resetSessionAuthorityForTests();
beginSessionAuthority('user-a');
beginSessionAuthority(null);
const secondA = beginSessionAuthority('user-a');
assert(secondA.generation === 3, `повторный вход того же человека обязан получить новое поколение, получили ${secondA.generation}`);

console.log('sessionAuthority.test OK');
