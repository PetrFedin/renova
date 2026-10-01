/**
 * Гейт сдачи этапа (STG-011). Сервер отвечает 409 (POST /work-acceptances, /submit)
 * или 422 (/ready) с detail `{ code: 'completion_gate', completion: { ok, checks, failed } }`.
 * Здесь — чистый разбор в человекочитаемый список; без зависимостей от React/сети.
 */

export type CompletionGateCheck = { id: string; message: string; action?: string; button?: string };

/** Запасные формулировки, если сервер не прислал message. */
export const COMPLETION_CHECK_LABEL: Record<string, string> = {
  assignee: 'Не назначен исполнитель',
  checklist: 'Чек-лист не завершён',
  photos_after: 'Нет фото результата',
  issues: 'Есть открытые замечания',
  materials: 'Материалы не доставлены',
  dependencies: 'Не выполнены зависимости этапа',
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Невыполненные условия из `ApiError.detail`; null — это не completion_gate. */
export function parseCompletionGate(detail: unknown): CompletionGateCheck[] | null {
  const d = asRecord(detail);
  if (!d || d.code !== 'completion_gate') return null;
  const completion = asRecord(d.completion);
  const raw = Array.isArray(completion?.failed)
    ? (completion!.failed as unknown[])
    : Array.isArray(completion?.checks)
      ? (completion!.checks as unknown[]).filter((c) => asRecord(c)?.ok === false)
      : [];
  const out: CompletionGateCheck[] = [];
  for (const item of raw) {
    const c = asRecord(item);
    if (!c) continue;
    const id = typeof c.id === 'string' ? c.id : 'unknown';
    const message =
      (typeof c.message === 'string' && c.message.trim()) || COMPLETION_CHECK_LABEL[id] || 'Условие сдачи не выполнено';
    out.push({
      id,
      message,
      action: typeof c.action === 'string' ? c.action : undefined,
      button: typeof c.button === 'string' ? c.button : undefined,
    });
  }
  // Гейт сработал, но список пуст — всё равно сообщаем, что сдача заблокирована.
  return out;
}

export const COMPLETION_GATE_TITLE = 'Этап пока нельзя сдать';

/** Текст для sheet/Alert: заголовок-пояснение + маркированный список. null — не гейт. */
export function completionGateMessage(detail: unknown): string | null {
  const checks = parseCompletionGate(detail);
  if (!checks) return null;
  if (!checks.length) return 'Не выполнены условия сдачи. Откройте этап и проверьте чек-лист, фото и замечания.';
  return ['Сначала выполните:', ...checks.map((c) => `• ${c.message}`)].join('\n');
}

/** Единая подача ошибки сдачи: { title, message } или null, если ошибка не про гейт. */
export function describeSubmitError(error: unknown): { title: string; message: string } | null {
  const detail = asRecord(error)?.detail;
  const message = completionGateMessage(detail);
  return message ? { title: COMPLETION_GATE_TITLE, message } : null;
}
