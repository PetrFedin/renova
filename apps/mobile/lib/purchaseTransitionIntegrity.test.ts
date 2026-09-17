import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mobile = join(__dirname, '..');
const repo = join(mobile, '..', '..');
const backend = (relativePath: string) => readFileSync(join(repo, 'backend', relativePath), 'utf8');
const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

/**
 * `a.indexOf(x) < a.indexOf(y)` passes when x is absent.
 *
 * A missing string gives -1, which is below every real index, so deleting the
 * guard entirely satisfies the assertion that the guard comes first. Both
 * strings have to be required explicitly.
 */
const mustPrecede = (source: string, before: string, after: string, message: string) => {
  const first = source.indexOf(before);
  const second = source.indexOf(after);
  must(first >= 0, `${message}: ${JSON.stringify(before)} is not present at all`);
  must(second >= 0, `${message}: ${JSON.stringify(after)} is not present at all`);
  must(first < second, message);
};

const endpoint = backend('app/api/v1/purchases.py');
const service = backend('app/services/purchase_service.py');
const dependencies = backend('app/services/dependency_service.py');

must(endpoint.includes('pur.transition_status('), 'purchase API uses scoped transition service');
must(!endpoint.includes('pur.set_status('), 'purchase API never mutates before project validation');
must(endpoint.includes('response["replayed"] = True'), 'same-status retry is explicit success');
must(endpoint.includes('purchase_transition_invalid') && endpoint.includes('purchase_transition_terminal'), 'API exposes strict transition errors');

must(service.includes('Purchase.id == purchase_id, Purchase.project_id == project_id'), 'purchase is scoped before mutation');
must(service.includes('query = query.with_for_update()'), 'purchase transition is row locked');
must(service.includes('validate_purchase_transition(current, status)'), 'purchase state graph is enforced');
mustPrecede(service, 'if current == status:', 'purchase.status = status', 'replay exits before mutation');
must(service.includes('was_delivered=current == PurchaseStatus.delivered'), 'inventory reversal depends on prior delivery');
// Accumulate, never assign: `qty_delivered = item.qty` would erase earlier
// partial deliveries. The literal drifted when `item.qty` gained its own
// `or 0` guard, which is the stricter spelling, so this matches the shape
// rather than one rendering of it.
//
// The "once" half is not a property of this line at all. It comes from the
// `if current == status: return` above, and is asserted behaviourally in
// backend/tests/test_purchase_transition_integrity.py
// ::test_delivery_replay_updates_inventory_and_fact_once — deliver, then
// replay, and qty_delivered is still 7, the expense count still 1, the outbox
// still 2 and budget_spent still 8400.
must(
  /pick\.qty_delivered = \(pick\.qty_delivered or 0\) \+ \(?item\.qty\b/.test(service),
  'delivery accumulates inventory rather than assigning it',
);
must(service.includes('max(0.0, (pick.qty_delivered or 0) - (item.qty or 0))'), 'return/cancel reverses delivered inventory once');
must(service.includes('await budget.refresh_budget_facts'), 'purchase facts use canonical budget refresh');
must(service.includes('activate_client_write_side_effects(effects)'), 'purchase effects are durable and immediately routable');

must(dependencies.includes('commit: bool = True'), 'dependency service supports deferred commit');
must(service.includes('commit=False'), 'purchase keeps dependency changes inside one transaction');

console.log('purchaseTransitionIntegrity.test OK');
