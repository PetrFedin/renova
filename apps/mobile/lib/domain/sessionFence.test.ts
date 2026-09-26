import {
  canPublish,
  describeStaleWrite,
  INITIAL_SESSION_STAMP,
  nextSessionStamp,
  type SessionStamp,
} from './sessionFence';

const a1: SessionStamp = { generation: 1, userId: 'user-a' };

if (canPublish(a1, a1) !== true) throw new Error('своя сессия должна публиковать');

// Вышли и вошли под другим — ответ первой сессии не должен публиковаться.
const b2: SessionStamp = { generation: 2, userId: 'user-b' };
if (canPublish(a1, b2)) throw new Error('чужая сессия не должна публиковать');

// A → B → A: человек тот же, но сессия другая. Поколение обязано отличать.
const a3: SessionStamp = { generation: 3, userId: 'user-a' };
if (canPublish(a1, a3)) throw new Error('повторный вход тем же человеком — другая сессия');

// Выход: публиковать некуда.
const nobody: SessionStamp = { generation: 4, userId: null };
if (canPublish(a1, nobody)) throw new Error('после выхода публиковать нечего');

// Операция, начатая без пользователя, не публикует никогда.
if (canPublish(INITIAL_SESSION_STAMP, a1)) throw new Error('операция без пользователя не публикует');
if (canPublish({ generation: 0, userId: null }, { generation: 0, userId: null })) {
  throw new Error('нет пользователя — нет публикации, даже при совпадении поколения');
}

// Поколение всегда растёт, в том числе при входе тем же человеком.
const first = nextSessionStamp(INITIAL_SESSION_STAMP, 'user-a');
if (first.generation !== 1 || first.userId !== 'user-a') throw new Error('первая метка');
const second = nextSessionStamp(first, 'user-a');
if (second.generation !== 2) throw new Error('повторный вход обязан менять поколение');
const out = nextSessionStamp(second, null);
if (out.generation !== 3 || out.userId !== null) throw new Error('выход тоже меняет поколение');
if (canPublish(second, out)) throw new Error('операция сессии не переживает выход');

// Подписи для отчёта об ошибке — чтобы в логе было видно причину.
if (!describeStaleWrite(a1, b2).includes('сессия сменилась')) throw new Error('подпись смены пользователя');
if (!describeStaleWrite(a1, a3).includes('поколение')) throw new Error('подпись смены поколения');
if (!describeStaleWrite(INITIAL_SESSION_STAMP, a1).includes('без пользователя')) {
  throw new Error('подпись операции без пользователя');
}

console.log('sessionFence.test OK');
