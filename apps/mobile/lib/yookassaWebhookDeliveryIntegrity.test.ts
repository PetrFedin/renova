import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const service = fs.readFileSync(path.join(root, 'backend/app/services/yookassa_service.py'), 'utf8');
const handler = fs.readFileSync(path.join(root, 'backend/app/api/v1/subscription.py'), 'utf8');

assert.match(service, /def webhook_event_key\(/, 'Webhook identity must be canonicalized');
assert.match(service, /raw = f"\{event\}:\{object_id\}"/, 'Event type and provider object id must both define identity');
assert.match(service, /async def was_webhook_processed\(/, 'Duplicate lookup must be read-only');
assert.match(service, /async def record_webhook_processed\(/, 'Completion must be persisted explicitly');

assert.doesNotMatch(
  handler,
  /remember_webhook_durable/,
  'HTTP handler must not claim the event before business processing',
);

const processIndex = handler.indexOf('result = await process_webhook(body, db)');
const recordIndex = handler.indexOf('record_webhook_processed(db, event_key');
assert.ok(processIndex >= 0, 'Handler must execute the business transition');
assert.ok(recordIndex > processIndex, 'Event completion must be recorded only after processing');
assert.match(handler, /if result\.get\("retryable"\):/, 'Retryable processing blocks must return non-2xx');
assert.match(handler, /raise HTTPException\(\s*503/, 'Retryable deliveries must ask the provider to redeliver');

console.log('YooKassa webhook delivery integrity contract passed');
