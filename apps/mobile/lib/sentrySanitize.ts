/**
 * Sentry beforeSend sanitization — strip tokens, auth, passwords,
 * payment requisites, document/message/file bodies. Never log secret values.
 */

const SENSITIVE_KEY =
  /authorization|access[_-]?token|refresh[_-]?token|password|secret|api[_-]?key|private[_-]?key|cookie|yookassa|payment[_-]?requisite|card[_-]?number|cvv|document[_-]?content|file[_-]?body|message[_-]?body|personal[_-]?message|bearer/i;

function redactString(value: string): string {
  let out = value;
  out = out.replace(/(bearer\s+)[A-Za-z0-9._\-+=/]+/gi, '$1[REDACTED]');
  out = out.replace(/(password\s*[=:]\s*)\S+/gi, '$1[REDACTED]');
  if (out.length > 2048) return '[REDACTED_LARGE_BODY]';
  return out;
}

export function redactMapping(data: unknown, depth = 0): unknown {
  if (depth > 8) return '[REDACTED_DEPTH]';
  if (data == null) return data;
  if (Array.isArray(data)) {
    return data.slice(0, 50).map((v) => redactMapping(v, depth + 1));
  }
  if (typeof data === 'object') {
    const src = data as Record<string, unknown>;
    const clean: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(src)) {
      if (SENSITIVE_KEY.test(key)) clean[key] = '[REDACTED]';
      else clean[key] = redactMapping(val, depth + 1);
    }
    return clean;
  }
  if (typeof data === 'string') return redactString(data);
  return data;
}

/** Compatible with @sentry/react-native Event shape (partial). */
export function sanitizeSentryEvent<T extends Record<string, unknown>>(event: T): T {
  const next = { ...event } as Record<string, unknown>;
  for (const section of ['request', 'extra', 'contexts', 'user', 'tags'] as const) {
    if (next[section] != null) {
      next[section] = redactMapping(next[section]);
    }
  }
  const req = next.request as Record<string, unknown> | undefined;
  if (req && typeof req === 'object') {
    if (req.headers && typeof req.headers === 'object') {
      const headers = req.headers as Record<string, unknown>;
      req.headers = Object.fromEntries(
        Object.entries(headers).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? '[REDACTED]' : v]),
      );
    }
    if ('data' in req) req.data = redactMapping(req.data);
    if ('cookies' in req) req.cookies = '[REDACTED]';
    next.request = req;
  }
  return next as T;
}
