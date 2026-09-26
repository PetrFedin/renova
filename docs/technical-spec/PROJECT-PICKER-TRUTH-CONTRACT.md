# Renova — project picker lifecycle truth contract

**Статус:** ACTIVE / governed annex  
**Область:** `apps/mobile/components/renova/os/OsProjectPicker.tsx`  
**Связь:** issue #409, #305 interaction/state truth

## Problem

Для проекта с `progress_percent >= 100` и отсутствующим `pending_payments` summary проект находится в неопределённом closing state, пока не подтверждено число ожидающих оплат.

`countPendingPayments` read failure **не означает ноль**. Ноль является бизнес-фактом только после успешного чтения. Подмена ошибки нулём могла передать `0` в `formatProjectPhaseLabel` и показать `Завершён`, хотя фактическое состояние оплат неизвестно.

## Contract

- значения `pending_payments` из authoritative project summary используются как подтверждённые;
- для closing projects без summary value выполняется enrichment read;
- успешный read может подтвердить `0` или положительное число;
- failed read остаётся observable через `reportError('projectPicker.pendingPayments', ...)`;
- failed read не добавляет запись в `pendingById`;
- отсутствие подтверждённого значения сохраняет `undefined`, поэтому `formatProjectPhaseLabel` показывает `Закрытие`, а не fabricated `Завершён`;
- один failed enrichment project не должен удалять успешно подтверждённые counts других проектов;
- picker presentation, project switch, portfolio totals, archive/trash actions and paywall handling are unchanged by this fix.

## Verification

`clarityWaveA.w153.test.ts` locks the source invariant:

- enrichment failure is observable;
- no failed-read `[projectId, 0]` fallback remains;
- unknown enrichment returns no confirmed row.

Existing `formatProjectPhaseLabel.test.ts` remains the canonical domain-label behavior check. Mobile typecheck and applicable full CI must remain green.

## Non-goals

- no Modal/sheet migration of the project picker;
- no change to payment calculation semantics;
- no global session-generation closure (#315);
- no portfolio redesign;
- no change to project lifecycle permissions.
