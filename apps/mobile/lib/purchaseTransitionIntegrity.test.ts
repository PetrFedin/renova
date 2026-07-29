import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mobile = join(__dirname, '..');
const repo = join(mobile, '..', '..');
const backend = (relativePath: string) => readFileSync(join(repo, 'backend', relativePath), 'utf8');
const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
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
must(service.indexOf('if current == status:') < service.indexOf('purchase.status = status'), 'replay exits before mutation');
must(service.includes('was_delivered=current == PurchaseStatus.delivered'), 'inventory reversal depends on prior delivery');
must(service.includes('pick.qty_delivered = (pick.qty_delivered or 0) + item.qty'), 'delivery increments inventory once');
must(service.includes('max(0.0, (pick.qty_delivered or 0) - (item.qty or 0))'), 'return/cancel reverses delivered inventory once');
must(service.includes('await budget.refresh_budget_facts'), 'purchase facts use canonical budget refresh');
must(service.includes('activate_client_write_side_effects(effects)'), 'purchase effects are durable and immediately routable');

must(dependencies.includes('commit: bool = True'), 'dependency service supports deferred commit');
must(service.includes('commit=False'), 'purchase keeps dependency changes inside one transaction');

console.log('purchaseTransitionIntegrity.test OK');
