/** Soft rate_limit: human message, GET retry/cache, loadProject swallow */
import { readFileSync } from 'fs';
import { join } from 'path';

const client = readFileSync(join(__dirname, 'api/client.ts'), 'utf8');
const ctx = readFileSync(join(__dirname, 'context/RenovaContext.tsx'), 'utf8');
const analytics = readFileSync(join(__dirname, '../components/renova/ProjectAnalyticsPanel.tsx'), 'utf8');

console.assert(client.includes("detail === 'rate_limit'") || client.includes('detail === \"rate_limit\"'), 'parse rate_limit msg');
console.assert(client.includes('error.status === 429 || error.code === \'rate_limit\''), 'cache fallback 429');
console.assert(client.includes('attempt < 2') && client.includes('retryAfterMs'), 'GET retry 429');
console.assert(ctx.includes('isRateLimitError(e)') && ctx.includes('return;'), 'loadProject soft');
console.assert(analytics.includes('isRateLimitError(e)'), 'analytics soft');

console.log('rateLimit.soft.test.ts OK');
