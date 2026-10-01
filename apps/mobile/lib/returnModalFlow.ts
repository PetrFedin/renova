/** Закрывать ли модалку «Вернуть на доработку» после ответа обработчика (CMP-020). */
export type ReturnResult = boolean | void;

/** Закрываем после успеха (или постановки в офлайн-очередь); при явной ошибке (false) остаёмся с введённой причиной. */
export function shouldCloseAfterReturn(result: ReturnResult): boolean {
  return result !== false;
}
