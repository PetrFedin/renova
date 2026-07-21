/** W150: Sentry sanitization */
import { sanitizeSentryEvent, redactMapping } from './sentrySanitize';

function must(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const event = sanitizeSentryEvent({
  request: {
    headers: { Authorization: 'Bearer tok', Accept: 'application/json' },
    data: { password: 'x', note: 'ok' },
  },
  extra: { access_token: 'abc', project_id: '1' },
});

must(event.request.headers.Authorization === '[REDACTED]', 'auth header redacted');
must(event.request.headers.Accept === 'application/json', 'safe header kept');
must(event.request.data.password === '[REDACTED]', 'password redacted');
must(event.extra.access_token === '[REDACTED]', 'token redacted');
must(event.extra.project_id === '1', 'safe extra kept');
must(String(redactMapping('a'.repeat(3000))) === '[REDACTED_LARGE_BODY]', 'large body');

console.log('sentrySanitize.w150.test.ts OK');
