import { readFileSync } from 'fs';
import { join } from 'path';
import type { OutboxDeadLetter } from './api/admin';
import {
  canClaimDeadLetter,
  canReplayDeadLetter,
  deadLetterClaimLabel,
  deadLetterDispatchLabel,
  deadLetterSafeSummary,
} from './domain/outboxDeadLetter';

const base: OutboxDeadLetter = {
  id: '11111111-1111-1111-1111-111111111111',
  aggregate_type: 'notification',
  aggregate_id: 'recipient-1',
  event_type: 'notification.created',
  created_at: '2026-08-05T12:00:00Z',
  attempts: 8,
  max_attempts: 8,
  error_code: 'internal_delivery_error',
  error_fingerprint: '0123456789abcdef',
  payload_size_bytes: 812,
  claim_state: 'unclaimed',
  claim_owner: null,
  claim_expires_at: null,
  replayable: true,
};

console.assert(canClaimDeadLetter(base), 'unclaimed poisoned event must be claimable');
console.assert(deadLetterClaimLabel(base) === 'Свободно', 'unclaimed label');
console.assert(!canReplayDeadLetter(base), 'replay requires a self-owned local claim');

const claimedByOther: OutboxDeadLetter = {
  ...base,
  claim_state: 'claimed',
  claim_owner: 'other',
  claim_expires_at: '2099-01-01T00:00:00Z',
  replayable: false,
};
console.assert(!canClaimDeadLetter(claimedByOther), 'another operator claim must be fenced');
console.assert(
  deadLetterClaimLabel(claimedByOther) === 'В работе у другого администратора',
  'other-owner label',
);

const claimedSelf: OutboxDeadLetter = {
  ...base,
  claim_state: 'claimed_self',
  claim_owner: 'self',
  claim_expires_at: '2099-01-01T00:00:00Z',
};
console.assert(
  canReplayDeadLetter(claimedSelf, { token: 'opaque-local-token', expiresAt: '2099-01-01T00:00:00Z' }, 0),
  'valid local claim must enable replay',
);
console.assert(
  !canReplayDeadLetter(claimedSelf, { token: 'opaque-local-token', expiresAt: '2000-01-01T00:00:00Z' }),
  'expired local claim must disable replay',
);

const summary = deadLetterSafeSummary({
  ...base,
  ...({
    payload_json: '{"provider_token":"must-not-render"}',
    last_error: 'smtp password must-not-render',
  } as unknown as OutboxDeadLetter),
});
console.assert(!summary.includes('must-not-render'), 'safe summary must ignore payload and raw exception fields');
console.assert(summary.includes('0123456789abcdef'), 'safe fingerprint remains available');
console.assert(deadLetterDispatchLabel('delivered') === 'Доставка выполнена', 'delivered feedback');
console.assert(deadLetterDispatchLabel('poisoned').includes('снова'), 're-poison feedback');

const mobileRoot = join(__dirname, '..');
const screen = readFileSync(
  join(mobileRoot, 'app/(contractor)/_screens/outbox-dead-letters.tsx'),
  'utf8',
);
const route = readFileSync(join(mobileRoot, 'app/(contractor)/[tool].tsx'), 'utf8');
const deepLinkRoute = readFileSync(join(mobileRoot, 'app/outbox-dead-letters.tsx'), 'utf8');
const dashboard = readFileSync(
  join(mobileRoot, 'app/(contractor)/_screens/admin-dashboard.tsx'),
  'utf8',
);

console.assert(screen.includes('Подтвердить повтор'), 'replay must require a second explicit action');
console.assert(screen.includes('claimOutboxDeadLetter'), 'screen must claim before replay');
console.assert(screen.includes('releaseOutboxDeadLetter'), 'screen must support release');
console.assert(screen.includes('getOutboxDeadLetterHistory'), 'screen must expose audit history');
console.assert(!screen.includes('payload_json'), 'screen must never reference raw payload');
console.assert(!screen.includes('last_error'), 'screen must never reference raw exception text');
console.assert(!screen.includes('{result.claim_token}'), 'claim token must never be rendered');
console.assert(!screen.includes('{localClaim.token}'), 'stored claim token must never be rendered');
console.assert(route.includes("'outbox-dead-letters': OutboxDeadLettersScreen"), 'operator route is registered');
console.assert(
  deepLinkRoute.includes("'./(contractor)/_screens/outbox-dead-letters'"),
  'explicit deep link must bypass root slug 404 while retaining backend RBAC',
);
console.assert(dashboard.includes('Открыть очередь восстановления событий'), 'dashboard links to recovery');

console.log('outboxDeadLetterAdminUi.test OK');
