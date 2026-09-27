/**
 * Единый источник истины для метки сессии (#315).
 *
 * `sessionFence.ts` описывает только чистую логику «поколение + пользователь».
 * Раньше метку хранил один `useRef` внутри `RenovaContext` — этого было
 * достаточно для `refreshProjects`/`loadProject`, но `lib/api/client.ts` и
 * `lib/offlineQueue.ts` живут вне React-дерева и не видят этот ref. Из-за
 * этого `authHeaders()` всегда прикладывал текущий глобальный Bearer к любому
 * `userId`, а офлайн-очередь могла отправить задание аккаунта A с токеном
 * аккаунта B после переключения пользователя на устройстве.
 *
 * Этот модуль — общий рубеж для всего мобильного клиента: `RenovaContext`
 * двигает поколение при входе/выходе, а `api/client.ts` и `offlineQueue.ts`
 * сверяются с ним перед тем, как приложить токен или отправить задание.
 */
import { INITIAL_SESSION_STAMP, nextSessionStamp, type SessionStamp } from './sessionFence';

let current: SessionStamp = INITIAL_SESSION_STAMP;

/** Текущая метка сессии — сравнивать через {@link canPublish}, не напрямую. */
export function getSessionStamp(): SessionStamp {
  return current;
}

/** `userId` активной сессии сейчас, либо `null`, если никто не вошёл. */
export function currentSessionUserId(): string | null {
  return current.userId;
}

/**
 * Сдвигает поколение сессии на весь клиент. Единственная точка записи —
 * вызывается из `RenovaContext` при входе, выходе и восстановлении сессии.
 */
export function beginSessionAuthority(userId: string | null): SessionStamp {
  current = nextSessionStamp(current, userId);
  return current;
}

/** Только для тестов: сбросить состояние модуля между независимыми сценариями. */
export function __resetSessionAuthorityForTests(): void {
  current = INITIAL_SESSION_STAMP;
}
