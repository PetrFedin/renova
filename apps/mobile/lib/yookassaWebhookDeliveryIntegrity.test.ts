import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const service = fs.readFileSync(path.join(root, 'backend/app/services/yookassa_service.py'), 'utf8');
const handler = fs.readFileSync(path.join(root, 'backend/app/api/v1/subscription.py'), 'utf8');
const delivery = fs.readFileSync(path.join(root, 'backend/app/services/webhook_delivery_service.py'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'backend/app/models/webhook_runtime.py'), 'utf8');

assert.match(service, /def webhook_event_key\(/, 'Webhook identity must be canonicalized');
assert.match(service, /raw = f"\{event\}:\{object_id\}"/, 'Event type and provider object id must both define identity');
assert.match(service, /def validate_webhook_envelope\(/, 'Provider envelope must be validated before any claim');
assert.match(service, /raise ValueError\("missing_provider_object_id"\)/, 'Missing provider identity must fail closed');

assert.match(handler, /secrets\.compare_digest\(/, 'Webhook secret comparison must be constant-time');
assert.doesNotMatch(handler, /record_webhook_processed\(/, 'HTTP handler must use atomic delivery completion, not the legacy helper');

const validateIndex = handler.indexOf('validate_webhook_envelope(body)');
const claimIndex = handler.indexOf('claim = await claim_delivery(');
const processIndex = handler.indexOf('result = await process_webhook(body, db)');
const completeIndex = handler.indexOf('if not await complete_delivery(');
assert.ok(validateIndex >= 0, 'Handler must validate the provider envelope');
assert.ok(claimIndex > validateIndex, 'A durable claim may be created only after envelope validation');
assert.ok(processIndex > claimIndex, 'Business processing must run only after acquiring the delivery claim');
assert.ok(completeIndex > processIndex, 'Business mutations and completion must commit after processing');

assert.match(handler, /claim\.status == "completed"/, 'Completed replay must skip business logic');
assert.match(handler, /claim\.status == "poisoned"/, 'Poisoned deliveries must be surfaced');
assert.match(handler, /"webhook_delivery_busy"/, 'Concurrent active delivery must return a retryable busy response');
assert.match(handler, /if result\.get\("retryable"\):/, 'Retryable business blocks must remain uncompleted');
assert.match(handler, /await fail_delivery\(/, 'Failure must release the owned claim with retry state');
assert.match(handler, /await abandon_delivery\(/, 'Cancellation must release the owned claim without consuming the event');
assert.match(handler, /"accepted": True/, 'Transport acceptance must be explicit');
assert.match(handler, /"business_applied": handled/, 'Business application must be reported separately from transport acceptance');

assert.match(runtime, /class PaymentWebhookDelivery\(/, 'Webhook delivery requires durable runtime state');
assert.match(runtime, /locked_by:/, 'Delivery state must persist the claim owner');
assert.match(runtime, /next_attempt_at:/, 'Delivery state must persist retry scheduling');
assert.match(runtime, /completed_at:/, 'Delivery state must persist completion');
assert.match(runtime, /last_error:/, 'Delivery state must persist failure evidence');

assert.match(delivery, /PaymentWebhookDelivery\.locked_by == claim_token/, 'Completion and failure must be owner-fenced');
assert.match(delivery, /db\.add\(\s*PaymentWebhookEvent\(/s, 'Completion must create the durable provider event marker');
const ownerFenceIndex = delivery.indexOf('PaymentWebhookDelivery.locked_by == claim_token');
const eventMarkerIndex = delivery.indexOf('db.add(\n        PaymentWebhookEvent(');
assert.ok(ownerFenceIndex >= 0, 'Owner fence must exist');
assert.ok(eventMarkerIndex > ownerFenceIndex, 'Provider completion marker must be added only after owner-fenced completion update');
assert.match(delivery, /await db\.flush\(\)\s*await db\.commit\(\)/s, 'Business state and completion marker must share one commit boundary');

console.log('YooKassa webhook delivery integrity contract passed');
