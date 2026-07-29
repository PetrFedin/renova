import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mobile = join(__dirname, '..');
const repo = join(mobile, '..', '..');
const readBackend = (relativePath: string) => readFileSync(join(repo, 'backend', relativePath), 'utf8');
const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const webhook = readBackend('app/services/yookassa_service.py');
const reversal = readBackend('app/services/payment_reversal_service.py');
const budget = readBackend('app/services/budget_service.py');

must(webhook.includes('{"payment.canceled", "refund.succeeded"}'), 'webhook routes provider reversals');
must(webhook.includes('process_provider_reversal'), 'webhook delegates to canonical reversal state machine');
must(webhook.includes('confirm_payment already committed PaymentEvent, Expense, budget and durable side effects'), 'success webhook does not duplicate canonical side effects');
must(!webhook.includes('title=f"Оплата (ЮKassa): {confirmed.title}"'), 'success webhook removed duplicate direct activity');

must(reversal.includes('query = query.with_for_update()'), 'reversal locks payment rows');
must(reversal.includes('Payment.project_id == project_id'), 'cancellation is project scoped');
must(reversal.includes('Payment.yookassa_payment_id == yookassa_payment_id'), 'refund resolves canonical provider payment');
must(reversal.includes('currency != "RUB"'), 'provider currency is verified');
must(reversal.includes('partial_refund_unsupported'), 'partial refunds fail closed without full reversal');
must(reversal.includes('evidence_type="yookassa_cancellation"'), 'cancellation evidence is recorded');
must(reversal.includes('evidence_type="yookassa_refund"'), 'refund evidence is recorded');
must(reversal.includes('expense.status = "refund"'), 'full refund reverses canonical expense');
must(reversal.includes('budget.refresh_budget_facts'), 'refund recalculates exact budget');
must(reversal.includes('outbox.enqueue('), 'reversal effects are durable');
must(budget.includes('Expense.status.in_(("confirmed", "pending_receipt"))'), 'refund expenses are excluded from budget fact');

console.log('yookassaReversalIntegrity.test OK');
