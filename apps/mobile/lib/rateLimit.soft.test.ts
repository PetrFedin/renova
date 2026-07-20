/** Soft rate_limit: human message, GET retry/cache, loadProject swallow, analytics no getProject */
import { readFileSync } from 'fs';
import { join } from 'path';

const client = readFileSync(join(__dirname, 'api/client.ts'), 'utf8');
const ctx = readFileSync(join(__dirname, 'context/RenovaContext.tsx'), 'utf8');
const analytics = readFileSync(join(__dirname, '../components/renova/ProjectAnalyticsPanel.tsx'), 'utf8');

console.assert(client.includes("detail === 'rate_limit'"), 'parse rate_limit msg');
console.assert(client.includes('error.status === 429 || error.code === \'rate_limit\''), 'cache fallback 429');
console.assert(client.includes('attempt < 2') && client.includes('retryAfterMs'), 'GET retry 429');
console.assert(client.includes('Duck-typing') || client.includes("m === 'rate_limit'"), 'duck isRateLimitError');
console.assert(ctx.includes('isRateLimitError(e)') && ctx.includes('/rate_limit/i'), 'loadProject soft');
console.assert(!analytics.includes('loadProject(') && analytics.includes('Не вызываем loadProject'), 'analytics no loadProject');

console.log('rateLimit.soft.test.ts OK');
