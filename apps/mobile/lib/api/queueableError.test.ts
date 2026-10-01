import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApiError } from './client';
import { isQueueableWriteError } from './queueableError';

const must = (c: boolean, m: string) => { if (!c) throw new Error(m); };

must(isQueueableWriteError(new ApiError(0, 'net', 'network')), 'ApiError(0) queues');
must(isQueueableWriteError(new ApiError(0, 'timeout', 'timeout')), 'timeout queues');
for (const s of [500, 502, 503, 504, 429]) must(isQueueableWriteError(new ApiError(s, 'x')), `${s} queues`);
for (const s of [400, 401, 403, 404, 409, 422]) must(!isQueueableWriteError(new ApiError(s, 'x')), `${s} is authoritative`);
must(isQueueableWriteError(new TypeError('Network request failed')), 'non-ApiError transport failure queues');

// CMP-001 guard: no wrapper may keep the dead `instanceof ApiError → throw` guard in front of enqueue.
const dir = __dirname;
for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts') && n !== 'client.ts' && n !== 'failurePolicy.ts' && n !== 'queueableError.ts')) {
  const src = readFileSync(join(dir, f), 'utf8');
  const re = /if \((\w+) instanceof ApiError[^)]*\) throw \1;[\s\S]{0,300}?offline_queued/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[0].includes('enqueue')) throw new Error(`${f}: ApiError guard before enqueue — use isQueueableWriteError`);
  }
}
console.log('queueableError.test.ts ok');
