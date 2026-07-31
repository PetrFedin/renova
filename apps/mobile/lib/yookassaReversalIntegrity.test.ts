import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mobile = join(__dirname, '..');
const repo = join(mobile, '..', '..');
const readBackend = (relativePath: string) => readFileSync(join(repo, 'backend', relativePath), 'utf8');
const must = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const webhook = readBackend('app/services/yookassa_service.py');
const endpoint = readBackend('app/api/v1/subscription.py');
const reversal = readBackend('app/services/payment_reversal_service.py');
const budget = readBackend('app/services/budget_service.py');
const budgetLegacy = readBackend('app/services/budget_service_legacy.py');
const ledger = readBackend('app/services/expense_ledger_service.py');

must(webhook.includes('{"payment.canceled", "refund.succeeded"}'), 'webhook routes provider reversals');
must(webhook.includes('process_provider_reversal(body, db, commit=False)'), 'webhook prepares reversal without an internal commit');
must(endpoint.includes('complete_delivery('), 'webhook endpoint commits business transition with durable delivery completion');
must(endpoint.includes('await db.rollback()'), 'webhook endpoint rolls back failed provider transitions');
must(!webhook.includes('title=f"Оплата (ЮKassa): {confirmed.title}"'), 'success webhook removed duplicate direct activity');

must(reversal.includes('query = query.with_for_update()'), 'reversal locks payment rows');
must(reversal.includes('Payment.project_id == project_id'), 'cancellation is project scoped');
must(reversal.includes('Payment.yookassa_payment_id == yookassa_payment_id'), 'refund resolves canonical provider payment');
must(reversal.includes('currency != "RUB"'), 'provider currency is verified');
must(reversal.includes('partial_refund_unsupported'), 'partial refunds fail closed without full reversal');
must(reversal.includes('refund_source_not_confirmed'), 'out-of-order refund remains retryable until payment confirmation');
must(reversal.includes('terminal_state_conflict'), 'terminal refund conflicts are monotonic and do not retry forever');
must(reversal.includes('evidence_type="yookassa_cancellation"'), 'cancellation evidence is recorded');
must(reversal.includes('evidence_type="yookassa_refund"'), 'refund evidence is recorded');
must(reversal.includes('expense.status = "refund"'), 'full refund reverses canonical expense');
must(reversal.includes('recalculate_existing_expense_facts'), 'refund uses status-preserving exact budget recalculation');
must(!reversal.includes('budget.refresh_budget_facts'), 'refund must not re-hydrate source facts');
must(reversal.includes('outbox.enqueue('), 'reversal effects are durable');
must(ledger.includes('Expense.status.in_(("confirmed", "pending_receipt"))'), 'ledger excludes disputed/refund expenses from budget fact');
must(!ledger.includes('expense_from_receipt') && !ledger.includes('expense_from_payment'), 'ledger cannot resurrect reversed source facts');
must(budgetLegacy.includes('Expense.status.in_(("confirmed", "pending_receipt"))'), 'preserved canonical aggregation excludes refund expenses');
must(budget.includes('_legacy.refresh_budget_facts = refresh_budget_facts'), 'canonical wrapper routes all refresh callers through protected hydration');

console.log('yookassaReversalIntegrity.test OK');
