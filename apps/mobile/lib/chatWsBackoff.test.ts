import assert from 'node:assert/strict';
import { classifyWsTicketFailure, nextWsDelayMs, wsReconnectDelayMs, WS_BACKOFF_MAX_MS } from './chatWsBackoff';

// без джиттера (random = 0.5 -> множитель 1.0)
const mid = () => 0.5;
assert.equal(wsReconnectDelayMs(1, mid), 2000);
assert.equal(wsReconnectDelayMs(2, mid), 4000);
assert.equal(wsReconnectDelayMs(3, mid), 8000);
assert.equal(wsReconnectDelayMs(5, mid), 32000);
assert.equal(wsReconnectDelayMs(6, mid), WS_BACKOFF_MAX_MS);
assert.equal(wsReconnectDelayMs(50, mid), WS_BACKOFF_MAX_MS);
assert.equal(wsReconnectDelayMs(0, mid), 2000);

// джиттер ±25%, потолок не превышается
assert.equal(wsReconnectDelayMs(1, () => 0), 1500);
assert.equal(wsReconnectDelayMs(1, () => 1), 2500);
assert.ok(wsReconnectDelayMs(20, () => 1) <= WS_BACKOFF_MAX_MS);

// монотонный рост до потолка
let prev = 0;
for (let i = 1; i <= 8; i += 1) {
  const d = wsReconnectDelayMs(i, mid);
  assert.ok(d >= prev);
  prev = d;
}

assert.equal(classifyWsTicketFailure(new Error('ws_auth_ticket_http_401')), 'stop');
assert.equal(classifyWsTicketFailure(new Error('ws_auth_ticket_http_403')), 'stop');
assert.equal(classifyWsTicketFailure(new Error('ws_auth_access_token_missing')), 'stop');
assert.equal(classifyWsTicketFailure(new Error('ws_auth_ticket_http_429')), 'retry');
assert.equal(classifyWsTicketFailure(new Error('ws_auth_ticket_http_503')), 'retry');
assert.equal(classifyWsTicketFailure(new TypeError('Network request failed')), 'retry');
assert.equal(classifyWsTicketFailure('boom'), 'retry');

// пауза 429-gate удлиняет задержку, но не сокращает
assert.equal(nextWsDelayMs(1, 30000, mid), 30000);
assert.equal(nextWsDelayMs(3, 1000, mid), 8000);
assert.equal(nextWsDelayMs(1, 0, mid), 2000);
console.log('chatWsBackoff ok');
