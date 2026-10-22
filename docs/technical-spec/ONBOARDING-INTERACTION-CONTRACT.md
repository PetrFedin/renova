# Renova — onboarding interaction contract

**Статус:** ACTIVE / governed annex  
**Область:** `apps/mobile/app/onboarding/_screens/role.tsx`  
**Связь:** #305 mobile design/interaction integrity

## Product intent

Первый экран должен отвечать на один вопрос пользователя: кто он в проекте — заказчик или исполнитель. Production-вход использует SMS без однопунктового переключателя режима. Демо-режим существует только при явном `EXPO_PUBLIC_DEMO=1` и не должен просачиваться в обычный production UX.

## Interaction contract

- выбор роли и, в demo build, режима входа сообщает о нажатии сразу через pressed-state;
- выбранное значение доступно assistive technologies как radio/checked state;
- disabled/team-join recovery state остаётся явно недоступным для competing changes;
- цвета берутся из `RenovaTheme`, без локальных hex;
- production UI не содержит внутренних подсказок про пилот, demo internals или расположение служебной навигации;
- один основной CTA: отправить SMS-код / продолжить / повторить вступление — в зависимости от текущего authoritative шага.

## Auth/team-join truth — не менять UI-полировкой

Authentication commit и team membership commit — разные события. Если вход уже выполнен, но вступление в бригаду не удалось, повторяется только join. Если membership уже committed, последующая ошибка `refreshMe` является reconciliation debt и не должна предлагать повторное использование одноразового invite token или повторный login.

Обязательные recovery paths:

- сохранить authenticated user id перед попыткой join;
- проверить business result через `requireSuccessfulTeamJoin`;
- join failure остаётся observable;
- post-commit access refresh failure остаётся observable, но не отменяет committed membership;
- пользователь имеет явный выход `Продолжить без вступления`.

## Verification

Минимальные source/CI contracts:

- `failClosed.w144.test.ts` сохраняет explicit demo fail-closed guard;
- `teamAccessFailClosed.w178.test.ts` сохраняет team-join recovery semantics и проверяет production-clear role choice;
- `typecheck:mobile` должен быть green;
- изменение не даёт production/staging/auth-provider readiness credit само по себе.
