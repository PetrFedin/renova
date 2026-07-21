/**
 * canMarkChatRead lifecycle.
 * Run: npx tsx apps/mobile/lib/domain/canMarkChatRead.test.ts
 */
import {
  evaluateCanMarkChatRead,
  shouldFireMarkRead,
  type ChatReadGateInput,
} from './canMarkChatRead';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const ready: ChatReadGateInput = {
  screenFocused: true,
  appForeground: true,
  threadLoaded: true,
  accessConfirmed: true,
  latestMessagesRendered: true,
  threadMatches: true,
};

// 1. нажал чат, навигация упала → mark не вызывается (нет focus/load)
assert(!evaluateCanMarkChatRead({
  ...ready,
  screenFocused: false,
  threadLoaded: false,
  accessConfirmed: false,
  latestMessagesRendered: false,
}), 'nav fail: no mark');

// 2. API 403
assert(!evaluateCanMarkChatRead({ ...ready, accessConfirmed: false, loadFailed: true }), '403');

// 3. API 404
assert(!evaluateCanMarkChatRead({ ...ready, loadFailed: true, threadLoaded: false }), '404');

// 4. загрузка сообщений ошибка
assert(!evaluateCanMarkChatRead({
  ...ready,
  threadLoaded: false,
  accessConfirmed: false,
  latestMessagesRendered: false,
  loadFailed: true,
}), 'load error');

// 5. экран в фоне
assert(!evaluateCanMarkChatRead({ ...ready, appForeground: false }), 'background');

// 6. foreground + всё готово
assert(evaluateCanMarkChatRead(ready), 'foreground ready');
assert(shouldFireMarkRead(false, true), 'edge fire');
assert(!shouldFireMarkRead(true, true), 'no re-fire while true');

// 7. новое сообщение во время загрузки — ещё не rendered
assert(!evaluateCanMarkChatRead({
  ...ready,
  threadLoaded: true,
  accessConfirmed: true,
  latestMessagesRendered: false,
}), 'msg during load');

// 8. повторное открытие — снова false→true
assert(shouldFireMarkRead(false, true), 'reopen edge');
assert(!shouldFireMarkRead(true, false), 'blur no fire');

// 9. offline open — нет access/load
assert(!evaluateCanMarkChatRead({
  ...ready,
  threadLoaded: false,
  accessConfirmed: false,
  loadFailed: true,
}), 'offline open');

// 10. восстановление сети → после успешного load gate открывается
assert(evaluateCanMarkChatRead(ready), 'network restore');

// 11. быстрый переход между тредами — threadMatches false
assert(!evaluateCanMarkChatRead({ ...ready, threadMatches: false }), 'thread switch stale');

// 12. старый API-ответ — loadFailed или mismatch
assert(!evaluateCanMarkChatRead({
  ...ready,
  threadMatches: false,
  accessConfirmed: true,
}), 'stale after switch');

console.log('canMarkChatRead.test OK');
