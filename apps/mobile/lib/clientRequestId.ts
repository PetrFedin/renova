const MAX_REQUEST_ID_LENGTH = 80;

function randomPart(): string {
  return Math.random().toString(36).slice(2, 12);
}

/**
 * Creates a compact opaque key for idempotent client-originated writes.
 * The caller must retain the key across retries and rotate it only after the
 * write succeeds or is durably accepted by the offline queue.
 */
export function createClientRequestId(scope: string): string {
  const safeScope = scope.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'write';
  const value = `${safeScope}-${Date.now().toString(36)}-${randomPart()}${randomPart()}`;
  return value.slice(0, MAX_REQUEST_ID_LENGTH);
}
