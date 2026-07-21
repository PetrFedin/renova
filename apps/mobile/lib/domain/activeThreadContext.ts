/**
 * Контекст «реально видимого» активного треда.
 *
 * Продуктовая политика: **Вариант A**
 * Любое сообщение в открытом foreground-треде с отрисованной лентой
 * считается прочитанным (не требуется попадание в viewport / Variant B).
 *
 * Недостаточно совпадения threadId — нужны focus, foreground,
 * loaded, access, messagesVisible.
 */

export type ActiveThreadContext = {
  threadId: string | null;
  userId: string | null;
  projectId: string | null;
  screenFocused: boolean;
  /** AppState === 'active' */
  appForeground: boolean;
  /**
   * Variant A: лента сообщений отрисована (rAF после load).
   * false при overlay/modal поверх чата или пока лента не painted.
   */
  messagesVisible: boolean;
  threadLoaded: boolean;
  accessConfirmed: boolean;
};

export const EMPTY_ACTIVE_THREAD_CONTEXT: ActiveThreadContext = {
  threadId: null,
  userId: null,
  projectId: null,
  screenFocused: false,
  appForeground: false,
  messagesVisible: false,
  threadLoaded: false,
  accessConfirmed: false,
};

/** Тред реально читается пользователем — unread не должен визуально расти */
export function isActivelyReadingThread(
  ctx: ActiveThreadContext,
  threadId: string | null | undefined,
): boolean {
  if (!threadId || !ctx.threadId || ctx.threadId !== threadId) return false;
  if (!ctx.userId) return false;
  return Boolean(
    ctx.screenFocused
    && ctx.appForeground
    && ctx.messagesVisible
    && ctx.threadLoaded
    && ctx.accessConfirmed,
  );
}

export const ACTIVE_THREAD_READ_POLICY = {
  variant: 'A' as const,
  description:
    'Сообщение в открытом foreground-треде с отрисованной лентой считается прочитанным; viewport intersection не требуется.',
};
