/**
 * Поведенческие гонки из #315: запоздавший ответ прежней сессии не должен
 * публиковать данные. Проверяется на модели операции контекста — с реальными
 * задержками и реальной сменой сессии между началом и публикацией.
 */
import { canPublish, INITIAL_SESSION_STAMP, nextSessionStamp, type SessionStamp } from './sessionFence';

type World = { current: SessionStamp; published: string | null; assigned: string[] };

function world(): World {
  return { current: INITIAL_SESSION_STAMP, published: null, assigned: [] };
}

function login(w: World, userId: string) {
  w.current = nextSessionStamp(w.current, userId);
}

function logout(w: World) {
  w.current = nextSessionStamp(w.current, null);
}

/** Операция контекста: берёт метку, ждёт сеть, потом публикует. */
async function loadProjects(w: World, label: string, delayMs: number): Promise<'опубликовано' | 'отброшено'> {
  const taken = w.current;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  if (!canPublish(taken, w.current)) return 'отброшено';
  w.published = label;
  return 'опубликовано';
}

/** Назначение исполнителя на объект — изменение прав, тоже под рубежом. */
async function loadAndAssign(w: World, projectId: string, delayMs: number) {
  const taken = w.current;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  if (!canPublish(taken, w.current)) return 'отброшено';
  w.assigned.push(`${taken.userId}:${projectId}`);
  return 'назначено';
}

async function main() {
  // 1. Вышли и вошли под другим: ответ прежней сессии не публикуется.
  {
    const w = world();
    login(w, 'user-a');
    const slow = loadProjects(w, 'объекты A', 40);
    logout(w);
    login(w, 'user-b');
    await loadProjects(w, 'объекты B', 1);
    if ((await slow) !== 'отброшено') throw new Error('ответ прежней сессии опубликован');
    if (w.published !== 'объекты B') throw new Error(`в состоянии осталось: ${w.published}`);
  }

  // 2. A → B → A: человек тот же, сессия другая.
  {
    const w = world();
    login(w, 'user-a');
    const slow = loadProjects(w, 'первая сессия A', 40);
    logout(w);
    login(w, 'user-b');
    logout(w);
    login(w, 'user-a');
    if ((await slow) !== 'отброшено') throw new Error('ответ прежней сессии того же человека опубликован');
    if (w.published !== null) throw new Error('опубликованы данные закрытой сессии');
  }

  // 3. Выход без нового входа: публиковать некуда.
  {
    const w = world();
    login(w, 'user-a');
    const slow = loadProjects(w, 'объекты A', 30);
    logout(w);
    if ((await slow) !== 'отброшено') throw new Error('после выхода данные опубликованы');
    if (w.published !== null) throw new Error('после выхода состояние изменилось');
  }

  // 4. Две конкурирующие загрузки одной сессии: обе имеют право публиковать,
  //    рубеж их не разделяет — это задача выбора объекта, а не сессии.
  {
    const w = world();
    login(w, 'user-a');
    const first = loadProjects(w, 'объект 1', 30);
    const second = loadProjects(w, 'объект 2', 5);
    if ((await second) !== 'опубликовано') throw new Error('вторая загрузка отброшена своей же сессией');
    if ((await first) !== 'опубликовано') throw new Error('первая загрузка отброшена своей же сессией');
  }

  // 5. Назначение исполнителя от устаревшей сессии не выполняется.
  {
    const w = world();
    login(w, 'contractor-a');
    const slow = loadAndAssign(w, 'project-1', 40);
    logout(w);
    login(w, 'contractor-b');
    if ((await slow) !== 'отброшено') throw new Error('назначение прошло под чужой сессией');
    if (w.assigned.length !== 0) throw new Error(`назначения: ${w.assigned.join(',')}`);
  }

  console.log('sessionFenceRace.test OK');
}

void main();
