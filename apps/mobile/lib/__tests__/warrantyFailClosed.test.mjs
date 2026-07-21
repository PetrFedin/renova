/**
 * node apps/mobile/lib/__tests__/warrantyFailClosed.test.mjs
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function must(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
}

// --- state machine (inline mirror of warrantyClaimsState.ts) ---
function warrantyListFromResponse(data) {
  const items = data.items || [];
  return {
    status: items.length === 0 ? 'loaded_empty' : 'loaded',
    items,
    open: data.open ?? items.filter((i) => i.status !== 'closed').length,
    errorMessage: null,
    stale: false,
  };
}
function warrantyListInitialError(message) {
  return { status: 'error', items: [], open: 0, errorMessage: message, stale: false };
}
function warrantyListRefreshError(prev, message) {
  return {
    ...prev,
    status: prev.items.length ? 'loaded' : prev.status === 'loaded_empty' ? 'loaded_empty' : 'error',
    errorMessage: message,
    stale: prev.items.length > 0 || prev.status === 'loaded_empty',
  };
}
function canSafelyCreateWarranty(state) {
  return state.status === 'loaded' || state.status === 'loaded_empty';
}

const err = warrantyListInitialError('network');
must(err.status === 'error', 'initial error status');
must(!canSafelyCreateWarranty(err), 'create blocked on error');
must(err.items.length === 0 && err.status !== 'loaded_empty', 'error ≠ empty list');

const loaded = warrantyListFromResponse({ items: [], open: 0 });
must(loaded.status === 'loaded_empty', 'empty loaded');
must(canSafelyCreateWarranty(loaded), 'create ok on empty loaded');

const withItems = warrantyListFromResponse({
  items: [{ id: '1', status: 'open' }],
  open: 1,
});
const refreshed = warrantyListRefreshError(withItems, 'timeout');
must(refreshed.items.length === 1, 'stale list kept');
must(refreshed.stale === true, 'stale flag');
must(refreshed.errorMessage === 'timeout', 'warning message');

// --- session keys ---
let pending = null;
function begin() {
  pending = `k-${Math.random()}`;
  return pending;
}
function retry() {
  if (!pending) pending = `k-${Math.random()}`;
  return pending;
}
function clear() {
  pending = null;
}
const a = begin();
const b = retry();
must(a === b, 'timeout retry same key');
clear();
const c = begin();
must(c !== a, 'new submit new key');

// --- source guards ---
const hub = readFileSync(join(root, '../components/renova/DocumentsHub.tsx'), 'utf8');
must(!hub.includes(".catch(() => ({ open: 0, items: []"), 'DocumentsHub no empty fallback');
must(hub.includes('beginWarrantyCreate') || hub.includes('Idempotency'), 'DocumentsHub idempotency');
must(hub.includes('Не удалось загрузить гарантии'), 'DocumentsHub list error UX');

const os = readFileSync(join(root, 'api/os.ts'), 'utf8');
must(os.includes('Idempotency-Key'), 'API sends Idempotency-Key');
must(os.includes('client_request_id'), 'API body client_request_id');

const session = readFileSync(join(root, 'warrantyCreateSession.ts'), 'utf8');
must(session.includes('beginWarrantyCreate'), 'session begin');
must(session.includes('warrantyCreateKeyForRetry'), 'session retry');

const nav = readFileSync(join(root, 'warrantyNav.ts'), 'utf8');
must(nav.includes('alertWarrantyConflict'), 'conflict alert');

console.log('OK warrantyFailClosed');
