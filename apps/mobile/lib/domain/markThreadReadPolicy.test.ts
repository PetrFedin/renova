/**
 * Политика mark-read idempotency.
 * Run: npx tsx apps/mobile/lib/domain/markThreadReadPolicy.test.ts
 */
import {
  clearMarkReadDiag,
  decideMarkReadAction,
  getMarkReadDiagSnapshot,
  isSameCursor,
  recordMarkReadDiag,
} from './markThreadReadPolicy';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

clearMarkReadDiag();

// 1. один вызов при открытии → send
assert(
  decideMarkReadAction({
    throughMessageId: 'm1',
    throughCreatedAt: '2024-01-02T00:00:00Z',
    confirmed: null,
    hasInflight: false,
  }).action === 'send',
  'open send',
);

// 2. повторный focus с тем же cursor → skip_same
assert(
  decideMarkReadAction({
    throughMessageId: 'm1',
    throughCreatedAt: '2024-01-02T00:00:00Z',
    confirmed: { messageId: 'm1', createdAt: '2024-01-02T00:00:00Z' },
    hasInflight: false,
  }).action === 'skip_same',
  'refocus same',
);

// 3. WebSocket и focus одновременно → await_inflight
assert(
  decideMarkReadAction({
    throughMessageId: 'm2',
    throughCreatedAt: '2024-01-03T00:00:00Z',
    confirmed: { messageId: 'm1', createdAt: '2024-01-02T00:00:00Z' },
    hasInflight: true,
  }).action === 'await_inflight',
  'concurrent await',
);

// 4. два одинаковых события
assert(
  isSameCursor({ messageId: 'm1', createdAt: 't' }, 'm1'),
  'same cursor',
);

// 5. более старый cursor после нового → skip_stale
assert(
  decideMarkReadAction({
    throughMessageId: 'm0',
    throughCreatedAt: '2024-01-01T00:00:00Z',
    confirmed: { messageId: 'm2', createdAt: '2024-01-03T00:00:00Z' },
    hasInflight: false,
  }).action === 'skip_stale',
  'stale',
);

// 6. retry после network error → force send
assert(
  decideMarkReadAction({
    force: true,
    throughMessageId: 'm1',
    throughCreatedAt: '2024-01-02T00:00:00Z',
    confirmed: { messageId: 'm1', createdAt: '2024-01-02T00:00:00Z' },
    hasInflight: false,
  }).action === 'send',
  'retry force',
);

// 7. два разных треда — решения независимы (проверяем отсутствие cross-talk в isSameCursor)
assert(!isSameCursor({ messageId: 'mA', createdAt: 't' }, 'mB'), 'different threads cursors');

// 8. быстрый double tap → второй await_inflight
assert(
  decideMarkReadAction({
    throughMessageId: 'm1',
    throughCreatedAt: 't',
    confirmed: null,
    hasInflight: true,
  }).action === 'await_inflight',
  'double tap',
);

// 9–10. Strict Mode / remount: первый send, второй same → skip
recordMarkReadDiag({
  threadId: 't1',
  throughMessageId: 'm1',
  source: 'thread_visible',
  outcome: 'sent',
});
recordMarkReadDiag({
  threadId: 't1',
  throughMessageId: 'm1',
  source: 'strict_remount',
  outcome: 'skipped_same',
});
const diag = getMarkReadDiagSnapshot();
assert(diag.length === 2, 'diag len');
assert(diag[0].outcome === 'sent' && diag[1].outcome === 'skipped_same', 'diag outcomes');
assert(!('text' in diag[0]), 'no message body in diag');

console.log('markThreadReadPolicy.test OK');
