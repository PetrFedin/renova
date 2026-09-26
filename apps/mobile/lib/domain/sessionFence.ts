/**
 * Рубеж сессии для операций, которые уже в полёте.
 *
 * Глобальные операции контекста (`refreshProjects`, `loadProject`) публикуют
 * состояние после нескольких `await`. За это время человек мог выйти и войти
 * под другим аккаунтом — и ответ первой сессии перезаписывал бы список
 * объектов нового пользователя или выбирал бы чужой объект активным.
 *
 * Рубеж — это пара «поколение + идентификатор пользователя». Поколение
 * меняется при каждой смене сессии, включая повторный вход тем же человеком:
 * иначе последовательность A → B → A не отличалась бы от непрерывной работы A.
 */
export type SessionStamp = {
  generation: number;
  userId: string | null;
};

export const INITIAL_SESSION_STAMP: SessionStamp = { generation: 0, userId: null };

/** Новая метка сессии: поколение всегда растёт, даже если человек тот же. */
export function nextSessionStamp(current: SessionStamp, userId: string | null): SessionStamp {
  return { generation: current.generation + 1, userId };
}

/**
 * Можно ли публиковать результат операции, начатой с меткой `taken`.
 *
 * Операция, начатая без пользователя, не публикует ничего никогда: её
 * результат не принадлежит никакой сессии.
 */
export function canPublish(taken: SessionStamp, current: SessionStamp): boolean {
  if (!taken.userId) return false;
  return taken.generation === current.generation && taken.userId === current.userId;
}

/** Почему результат отброшен — для отчёта об ошибке, а не для человека. */
export function describeStaleWrite(taken: SessionStamp, current: SessionStamp): string {
  if (!taken.userId) return 'операция началась без пользователя';
  if (taken.userId !== current.userId) {
    return `сессия сменилась: начато под ${taken.userId}, сейчас ${current.userId ?? 'никто'}`;
  }
  if (taken.generation !== current.generation) {
    return `поколение сессии сменилось: ${taken.generation} → ${current.generation}`;
  }
  return 'рубеж пройден';
}
