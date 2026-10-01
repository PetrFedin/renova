/**
 * QLT-004/006: форма гарантии и жизненный цикл замечаний без исполнителя.
 * Run: tsx apps/mobile/lib/domain/warrantyForm.test.ts
 */
import assert from 'node:assert/strict';
import { normalizeWarrantyComment, normalizeWarrantyForm } from './warrantyForm';
import { issueActions, issueWaitingHint, isIssueTransitionAllowed, warrantyActions, warrantyWaitingHint } from './issueLifecycle';

// форма: шаблонный текст больше не подставляется, пустое не проходит
assert.deepEqual(normalizeWarrantyForm('', 'трещина'), { ok: false, error: 'title_required' });
assert.deepEqual(normalizeWarrantyForm('Трещина', '  '), { ok: false, error: 'description_required' });
const ok = normalizeWarrantyForm('  Трещина   в ламинате ', ' Через две недели после сдачи ');
assert.ok(ok.ok && ok.value.title === 'Трещина в ламинате' && ok.value.description === 'Через две недели после сдачи');
assert.equal(normalizeWarrantyComment('   '), undefined);
assert.equal(normalizeWarrantyComment(' не  гарантия '), 'не гарантия');

// проект без исполнителя: заказчик закрывает сразу
const solo = issueActions('open', 'customer', false, { selfManaged: true });
assert.equal(solo.length, 1);
assert.equal(solo[0].target, 'closed');
assert.equal(issueActions('open', 'customer').length, 0, 'с исполнителем заказчик open не закрывает');
assert.equal(isIssueTransitionAllowed('in_progress', 'closed', 'customer', { selfManaged: true }), true);
assert.equal(isIssueTransitionAllowed('in_progress', 'closed', 'customer'), false);
assert.equal(issueWaitingHint('open', 'customer', false, { selfManaged: true }), null);
assert.equal(issueWaitingHint('open', 'customer'), 'Ждёт исправления исполнителем');
// fixed/closed в самоуправляемом проекте остаются прежними
assert.equal(issueActions('closed', 'customer', false, { selfManaged: true })[0].label, 'Открыть снова');

// гарантия: ответ исполнителя, закрытие/повторное открытие заказчика
assert.deepEqual(warrantyActions('open', 'contractor').map((a) => a.kind), ['accept', 'reject']);
assert.equal(warrantyActions('open', 'contractor').find((a) => a.kind === 'reject')?.comment, 'required');
assert.deepEqual(warrantyActions('in_progress', 'contractor').map((a) => a.kind), ['fixed', 'reject']);
assert.deepEqual(warrantyActions('closed', 'contractor'), []);
assert.deepEqual(warrantyActions('closed', 'customer').map((a) => a.kind), ['reopen']);
assert.deepEqual(warrantyActions('rejected', 'customer').map((a) => a.kind), ['close', 'reopen']);
assert.deepEqual(warrantyActions('open', 'customer').map((a) => a.kind), ['close']);
assert.equal(warrantyWaitingHint('open', 'customer'), 'Ждёт ответа исполнителя');
assert.equal(warrantyWaitingHint('fixed', 'contractor'), 'Ждёт решения заказчика');
console.log('warrantyForm.test OK');
