/**
 * #316 требует разобрать каждую очередь записи отдельно. Реестр держит этот
 * разбор в коде; тест не даёт ему разойтись с исходниками — ни в одну сторону.
 *
 * Важно: тест не объявляет незащищённые очереди безопасными. Он фиксирует их
 * число, чтобы новые не появлялись молча, а закрытые уменьшали остаток.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { parseQueuedWrites, queuedWriteKey, type QueuedWriteKind } from './offline/queuedWrites';
import { QUEUED_WRITE_REGISTRY, UNPROTECTED_QUEUED_WRITES } from './offline/queuedWriteRegistry';

const apiDir = join(__dirname, 'api');

const found = new Map<string, QueuedWriteKind>();
const where = new Map<string, string>();
for (const name of readdirSync(apiDir)) {
  if (!name.endsWith('.ts') || name.includes('.test.')) continue;
  const source = readFileSync(join(apiDir, name), 'utf8');
  for (const write of parseQueuedWrites(name, source)) {
    const key = queuedWriteKey(write);
    if (!found.has(key)) {
      found.set(key, write.kind);
      where.set(key, `${write.apiFile}::${write.apiMethod}`);
    }
  }
}

if (found.size < 40) throw new Error(`разобрано слишком мало очередей: ${found.size}`);

const missing = [...found.keys()].filter((key) => !(key in QUEUED_WRITE_REGISTRY));
if (missing.length) {
  throw new Error(
    'новая очередь записи не разобрана в реестре (#316):\n  ' +
      missing.map((k) => `${k}  ← ${where.get(k)}`).join('\n  '),
  );
}

const stale = Object.keys(QUEUED_WRITE_REGISTRY).filter((key) => !found.has(key));
if (stale.length) {
  throw new Error(`реестр описывает очереди, которых больше нет:\n  ${stale.join('\n  ')}`);
}

const wrong = [...found.entries()].filter(([key, kind]) => QUEUED_WRITE_REGISTRY[key] !== kind);
if (wrong.length) {
  throw new Error(
    'разбор в реестре разошёлся с кодом:\n  ' +
      wrong
        .map(([key, kind]) => `${key}: в коде «${kind}», в реестре «${QUEUED_WRITE_REGISTRY[key]}»`)
        .join('\n  '),
  );
}

const unprotected = [...found.values()].filter((kind) => kind === 'unprotected').length;
if (unprotected > UNPROTECTED_QUEUED_WRITES) {
  throw new Error(
    `незащищённых очередей стало больше: ${unprotected} против ${UNPROTECTED_QUEUED_WRITES}. ` +
      'Новая очередь POST с телом обязана нести client_request_id.',
  );
}
if (unprotected < UNPROTECTED_QUEUED_WRITES) {
  throw new Error(
    `незащищённых очередей осталось ${unprotected}, а в реестре записано ${UNPROTECTED_QUEUED_WRITES}. ` +
      'Уменьшите число в реестре — остаток по #316 сократился.',
  );
}

// Заголовок, который никто не читает, не должен выглядеть защитой.
const queue = readFileSync(join(__dirname, 'offlineQueue.ts'), 'utf8');
if (queue.includes('X-Offline-Id')) {
  throw new Error('X-Offline-Id снова отправляется, хотя сервер его не читает (#316)');
}

console.log(`queuedWriteRegistry.test OK (очередей ${found.size}, без ключа ${unprotected})`);
