# Renova — PrimaryButton semantic haptic contract

**Статус:** ACTIVE / governed migration annex  
**Область:** `apps/mobile/components/renova/PrimaryButton.tsx`  
**Связь:** issue #400, #305 interaction consistency

## 1. Intent

`PrimaryButton` остаётся canonical CTA primitive. Haptic feedback перестаёт быть неявным смыслом любой кнопки и переводится на явный semantic intent без одномоментного изменения существующего поведения всех call sites.

Этот change-set вводит только backwards-compatible API. Он **не** меняет default user-visible haptic текущих немигрированных кнопок: `hapticIntent="legacy"` сохраняет существующий Light impact.

## 2. Press haptic intents

```text
legacy       → existing Light impact; временный default для немигрированных call sites
none         → no press haptic
selection    → selection feedback
commit       → Light impact at press/commit intent
Destructive  → Medium impact at destructive commit intent
```

В TypeScript значение destructive называется `destructive`.

Правила:

- disabled/loading button не запускает haptic и не вызывает action;
- ordinary navigation должна постепенно мигрировать на `none`;
- selection/detent actions могут использовать `selection`;
- meaningful local commit may use `commit` only when press itself is the causal commit moment;
- destructive intent uses `destructive` only for an explicit confirmed destructive action;
- haptic never replaces visual/text status.

## 3. Outcome feedback is outside PrimaryButton

`success` и `error` сознательно отсутствуют в `PrimaryButtonHapticIntent`.

Причина: success/error являются свойством authoritative результата операции, а не события press. Если domain flow использует outcome haptic, он должен запускаться только после подтверждённого outcome в соответствующем service/screen orchestration и сопровождаться полноценным visual/text feedback.

Запрещено:

```text
press → Success haptic → API pending
press → Error haptic без authoritative refusal/failure
```

## 4. Migration order

1. Ввести semantic API при сохранении `legacy` default.
2. Проинвентаризировать call sites по пользовательскому смыслу, не по тексту кнопки.
3. Мигрировать bounded группами: navigation/selection → finance/acceptance → destructive actions.
4. После классификации всех canonical call sites отдельным change-set удалить implicit legacy default либо изменить default только с полным regression evidence.

## 5. Verification

- `clarityWaveA.w153.test.ts` проверяет наличие semantic API и сохранение `legacy` default;
- `SCREEN-SOURCE-SNAPSHOT.md` содержит exact blob SHA текущего `PrimaryButton.tsx`;
- `technicalSpecAnnexContract.test.mjs` должен оставаться green;
- `typecheck:mobile` и `mobile:test` должны оставаться green;
- изменение API само по себе не является доказательством device-level tactile feel или production verification.

## 6. Non-goals

- не менять business mutation semantics;
- не добавлять haptic на every press;
- не вводить новый haptic package;
- не смешивать Reduced Motion с haptic policy;
- не выполнять массовую миграцию call sites без domain-level проверки.
