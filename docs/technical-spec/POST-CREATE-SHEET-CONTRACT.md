# Renova — post-create next-step sheet contract

**Статус:** ACTIVE / governed annex  
**Область:** `apps/mobile/components/renova/os/home/PostCreateSheet.tsx`  
**Связь:** issue #402, #305 interaction consistency

## Intent

После успешного создания объекта Renova не делает неожиданный jump, а показывает ограниченный список дальнейших шагов. Это presentation/navigation surface: создание проекта уже произошло до открытия sheet, поэтому этот компонент не должен повторно выполнять project mutation или трактовать закрытие sheet как отмену созданного объекта.

## Presentation contract

- использовать canonical `SheetSurface`, а не отдельный `Modal`/backdrop/sheet chrome;
- заголовок: `Объект создан`;
- subtitle включает имя уже созданного проекта;
- 5 существующих next-step destinations и их canonical href не меняются presentation migration;
- строки дают immediate press feedback, accessibility label и hint;
- `На главную` — shared tertiary/ghost button in sheet footer;
- close/backdrop закрывает только chooser и не откатывает созданный объект.

## Navigation truth

Existing destinations remain authoritative:

- Смета → `objectTabHref('customer', 'estimate')`;
- Подключить исполнителя → `customerProfileTabHref('customer', 'contractor')`;
- План и документы → `objectTabHref('customer', 'plan')`;
- Контроль бюджета → `tabsHref('customer', 'budget', 'summary')`;
- Начать ремонт → `repairTabHref('customer', 'works')`.

This annex does not create a new hub or redirect policy.

## Verification

- `clarityWaveT.w173.test.ts` requires canonical `SheetSurface`, immediate pressed feedback, accessibility hint and shared footer button;
- `connectContractorNav.w137.test.ts` continues to verify contractor invite destination;
- `typecheck:mobile` and applicable full CI must remain green;
- motion/reduced-motion behavior is inherited from shared `SheetSurface`; if #397 merges first, the component automatically receives the shared policy without local motion code.

## Non-goals

- no wizard/create mutation change;
- no new next-step destination;
- no reorder/experimentation of the five steps;
- no change to `syncProjectSideEffects` or project creation recovery;
- no global Modal migration.
