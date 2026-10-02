/**
 * O-4: автоскрытие плавающей «+» при прокрутке вниз.
 *
 * Чистая логика без react-native: тест выполняется обычным node. Кнопка
 * прячется, пока пользователь листает вниз (контент не перекрыт), и
 * возвращается при прокрутке вверх, у верха списка и после остановки.
 */
export const FAB_HIDE_DELTA = 8;
export const FAB_TOP_ZONE = 16;
export const FAB_IDLE_MS = 700;

export type FabScrollTracker = {
  /** Новая позиция прокрутки (offsetY / scrollTop). Возвращает true, если кнопку надо скрыть. */
  onScroll: (offsetY: number) => boolean;
  /** Прокрутка остановилась. */
  onIdle: () => boolean;
  isHidden: () => boolean;
  reset: () => void;
};

export function createFabScrollTracker(): FabScrollTracker {
  let last = 0;
  let hidden = false;
  return {
    onScroll(offsetY) {
      const y = Math.max(0, offsetY);
      const delta = y - last;
      if (y <= FAB_TOP_ZONE) hidden = false;
      else if (delta >= FAB_HIDE_DELTA) hidden = true;
      else if (delta <= -FAB_HIDE_DELTA) hidden = false;
      // Малые шевеления внутри порога состояние не меняют; позицию не двигаем,
      // чтобы медленная прокрутка накапливалась до порога.
      if (Math.abs(delta) >= FAB_HIDE_DELTA || y <= FAB_TOP_ZONE) last = y;
      return hidden;
    },
    onIdle() {
      hidden = false;
      return hidden;
    },
    isHidden: () => hidden,
    reset() {
      last = 0;
      hidden = false;
    },
  };
}

type Listener = (hidden: boolean) => void;
const listeners = new Set<Listener>();
const tracker = createFabScrollTracker();
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function emit(hidden: boolean) {
  listeners.forEach((l) => l(hidden));
}

/** Экраны вызывают из onScroll (нативные платформы); на вебе подписка глобальная. */
export function reportFabScroll(offsetY: number) {
  const before = tracker.isHidden();
  const hidden = tracker.onScroll(offsetY);
  if (hidden !== before) emit(hidden);
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (tracker.isHidden()) emit(tracker.onIdle());
  }, FAB_IDLE_MS);
}

/** Для ScrollView/FlatList: `onScroll={fabOnScroll} scrollEventThrottle={32}`. */
export function fabOnScroll(e: { nativeEvent: { contentOffset: { y: number } } }) {
  reportFabScroll(e.nativeEvent.contentOffset.y);
}

export function subscribeFabHidden(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function resetFabHidden() {
  tracker.reset();
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  emit(false);
}
