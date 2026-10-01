/** npx tsx lib/domain/acceptanceActions.test.ts */
import { effectiveAcceptanceRole, acceptanceActions, buildReworkItems, latestReturnedAcceptance, normalizeReturnReason, stageStatusText, acceptanceStatusLabel } from './acceptanceActions';
import { parseCompletionGate, completionGateMessage, describeSubmitError } from './completionGate';

const must = (c: boolean, m: string) => { if (!c) throw new Error(m); };

// заказчик на review: принять + вернуть
const cr = acceptanceActions({ role: 'customer', stageStatus: 'review' });
must(cr.canDecide && !cr.canSubmit && !cr.canResubmit && !cr.statusOnly, 'customer/review decides');
must(!acceptanceActions({ role: 'customer', stageStatus: 'review', canReview: false }).canDecide, 'can_review=false hides decide');
// исполнитель на review: только статус (UI-010)
const kr = acceptanceActions({ role: 'contractor', stageStatus: 'review' });
must(!kr.canDecide && kr.statusOnly && kr.statusText === 'Ждёт решения заказчика', 'contractor/review is status only');
// active: сдача / повторная сдача
must(acceptanceActions({ role: 'contractor', stageStatus: 'active', canSubmit: true }).canSubmit, 'contractor submit');
const re = acceptanceActions({ role: 'contractor', stageStatus: 'active', needsRework: true, canSubmit: true });
must(re.canResubmit && !re.canSubmit && re.statusText === 'Возвращено на доработку', 'contractor resubmit after return');
must(!acceptanceActions({ role: 'contractor', stageStatus: 'active', canSubmit: false }).canSubmit, 'capability false hides submit');
must(!acceptanceActions({ role: 'customer', stageStatus: 'active', needsRework: true }).canDecide, 'customer has no buttons during rework');
must(acceptanceActions({ role: 'customer', stageStatus: 'done' }).statusText === 'Принято', 'done');
must(acceptanceActions({ role: 'contractor', stageStatus: 'planned' }).statusOnly, 'planned: nothing');

must(stageStatusText({ status: 'active', needs_rework: true }, { active: 'В работе' }) === 'Возвращён на доработку', 'rework label');
must(stageStatusText({ status: 'review' }, { review: 'На приёмке' }) === 'На приёмке', 'label map');
must(acceptanceStatusLabel('returned') === 'Возвращено на доработку' && acceptanceStatusLabel('zzz') === 'zzz', 'acceptance label');

must(normalizeReturnReason('  ') === null && normalizeReturnReason(null) === null && normalizeReturnReason(' плитка ') === 'плитка', 'reason required');

const acc = [
  { stage_id: 's1', status: 'accepted', comment: null, created_at: '2026-01-01T00:00:00' },
  { stage_id: 's1', status: 'returned', comment: 'Швы неровные', created_at: '2026-01-03T00:00:00' },
  { stage_id: 's1', status: 'returned', comment: 'старая', created_at: '2026-01-02T00:00:00' },
];
must(latestReturnedAcceptance(acc, 's1')?.comment === 'Швы неровные', 'latest returned');
must(latestReturnedAcceptance(acc, 's2') === null, 'none');
const items = buildReworkItems(
  [
    { id: 's1', name: 'Плитка', status: 'active', needs_rework: true, rework_deadline: '2026-02-01T00:00:00' },
    { id: 's2', name: 'Пол', status: 'review', needs_rework: true },
    { id: 's3', name: 'Стены', status: 'active' },
  ],
  acc,
);
must(items.length === 1 && items[0].reason === 'Швы неровные' && items[0].deadline === '2026-02-01', 'rework items');

// completion_gate
const gate = {
  code: 'completion_gate',
  completion: {
    ok: false,
    checks: [],
    failed: [
      { id: 'checklist', ok: false, message: 'Чек-лист 50% — выполните все пункты' },
      { id: 'photos_after', ok: false },
      { id: 'issues', ok: false, message: 'Открыты критичные замечания: 2' },
      { id: 'materials', ok: false, message: 'Не хватает материалов: 1' },
      { id: 'dependencies', ok: false, message: 'Дождитесь «Электрика»' },
    ],
  },
};
const parsed = parseCompletionGate(gate)!;
must(parsed.length === 5 && parsed[1].message === 'Нет фото результата', 'fallback label by id');
const msg = completionGateMessage(gate)!;
must(msg.includes('• Чек-лист 50%') && msg.includes('• Открыты критичные замечания: 2') && msg.includes('• Дождитесь'), 'message lists items');
must(parseCompletionGate({ code: 'other' }) === null && parseCompletionGate('x') === null && parseCompletionGate(null) === null, 'not a gate');
must(parseCompletionGate({ code: 'completion_gate', completion: { checks: [{ id: 'a', ok: true }, { id: 'checklist', ok: false }] } })!.length === 1, 'derive from checks');
must(completionGateMessage({ code: 'completion_gate' })!.includes('Не выполнены условия'), 'empty gate still explained');
must(describeSubmitError({ status: 409, detail: gate })!.title === 'Этап пока нельзя сдать', 'describeSubmitError');
must(describeSubmitError(new Error('x')) === null, 'plain error not gate');

must(effectiveAcceptanceRole('contractor', 'customer') === 'contractor', 'contractor never gets customer UI');
must(effectiveAcceptanceRole('customer', 'contractor') === 'customer', 'customer role wins');
must(effectiveAcceptanceRole(undefined, 'customer') === 'customer' && effectiveAcceptanceRole(null, 'contractor') === 'contractor', 'fallback to route role');

console.log('acceptanceActions.test.ts ok');
