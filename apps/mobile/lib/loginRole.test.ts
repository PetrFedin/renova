import { resolveLoginRole } from './loginRole';

function must(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const same = resolveLoginRole('customer', 'customer');
must(same.role === 'customer' && same.mismatchMessage === null, 'matching role must pass silently');

const mismatch = resolveLoginRole('customer', 'contractor');
must(mismatch.role === 'contractor', 'navigation must follow the server role, not the toggle');
must(
  !!mismatch.mismatchMessage && mismatch.mismatchMessage.includes('Исполнитель') && mismatch.mismatchMessage.includes('Заказчик'),
  'mismatch must be explained to the user',
);

const unknown = resolveLoginRole('contractor', undefined);
must(unknown.role === 'contractor' && unknown.mismatchMessage === null, 'unknown server role falls back to selection');

console.log('loginRole.test OK');
