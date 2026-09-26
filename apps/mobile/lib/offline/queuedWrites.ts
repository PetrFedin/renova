/**
 * Разбор очереди офлайн-записей по исходникам клиента.
 *
 * #316 требует разобрать каждую очередь отдельно, а не считать их скопом
 * безопасными или небезопасными. Разбор живёт в коде, а не в документе,
 * чтобы список нельзя было тихо разойтись с действительностью.
 */
export type QueuedWriteKind =
  /** Тело несёт `client_request_id`: повтор узнаётся сервером. */
  | 'identity'
  /** Пустое тело: переход состояния, повтор гасит машина состояний на сервере. */
  | 'transition'
  /** PATCH/PUT/DELETE: повтор переписывает ту же строку, второй не появляется. */
  | 'non-create'
  /** POST с телом без ключа: повтор после потери ответа может создать дубль. */
  | 'unprotected';

export type QueuedWrite = {
  method: string;
  path: string;
  apiFile: string;
  apiMethod: string;
  kind: QueuedWriteKind;
};

const PARAM = /\$\{[^}]*\}/g;

/** `/projects/${id}/stages` → `/projects/:param/stages`. */
export function normalizeQueuedPath(raw: string): string {
  return raw.replace(PARAM, ':param');
}

export function classifyQueuedWrite(input: {
  method: string;
  body: string;
  hasIdentityNearby: boolean;
}): QueuedWriteKind {
  const body = input.body.trim();
  // Порядок важен: ключ сильнее прочих признаков, он узнаёт повтор явно.
  if (input.hasIdentityNearby) return 'identity';
  if (input.method !== 'POST') return 'non-create';
  if (body === "'{}'" || body === '"{}"') return 'transition';
  return 'unprotected';
}

/**
 * Разбирает исходник одного файла `lib/api/*.ts`.
 *
 * Намеренно работает по тексту: очередь собирается литералом прямо в месте
 * вызова, и читать её так надёжнее, чем исполнять клиент в тесте.
 */
export function parseQueuedWrites(fileName: string, source: string): QueuedWrite[] {
  const out: QueuedWrite[] = [];
  const enqueueAt = /enqueue\(\{/g;
  let match: RegExpExecArray | null;
  while ((match = enqueueAt.exec(source)) !== null) {
    const tail = source.slice(match.index, match.index + 600);
    const end = tail.indexOf('});');
    const block = end === -1 ? tail : tail.slice(0, end);

    const methodMatch = /method:\s*'([A-Z]+)'/.exec(block);
    const pathMatch = /path:\s*`([^`]+)`/.exec(block);
    const bodyMatch = /body:\s*([^,\n]+)/.exec(block);
    if (!methodMatch || !pathMatch) continue;

    const head = source.slice(0, match.index);
    const names = [...head.matchAll(/^ {2}(\w+):\s*(?:async\s*)?\(/gm)];
    const apiMethod = names.length ? names[names.length - 1][1] : 'unknown';

    // Ключ ищем в пределах самого метода, а не всего файла: иначе соседний
    // защищённый метод выдал бы чужую защиту за свою.
    const methodStart = names.length ? names[names.length - 1].index ?? 0 : 0;
    const scope = source.slice(methodStart, match.index + block.length);

    out.push({
      method: methodMatch[1],
      path: normalizeQueuedPath(pathMatch[1]),
      apiFile: fileName,
      apiMethod,
      kind: classifyQueuedWrite({
        method: methodMatch[1],
        body: bodyMatch ? bodyMatch[1] : '',
        hasIdentityNearby: scope.includes('client_request_id'),
      }),
    });
  }
  return out;
}

export function queuedWriteKey(write: Pick<QueuedWrite, 'method' | 'path'>): string {
  return `${write.method} ${write.path}`;
}
