# Renova — Quick FAB interaction contract

**Статус:** ACTIVE / governed annex  
**Область:** `apps/mobile/components/renova/os/OsQuickFab.tsx`  
**Связь:** #305 mobile design/interaction integrity

## Product intent

Quick FAB остаётся единой точкой создания контекстных действий и не превращается в альтернативное меню навигации. Бизнес-набор действий, role/detail-level policy, permissions и маршрутизация остаются authoritative в существующих domain/navigation helpers.

## Presentation contract

- bottom-sheet chrome использует shared `SheetSurface`, а не собственный `Modal`/backdrop/sheet implementation;
- строки действий дают immediate pressed feedback и accessibility label/hint;
- visual tokens берутся из `RenovaTheme`/`uiTokens`;
- cancel использует shared button primitive;
- FAB скрыт при отсутствии user/project и в read-only mode, как и до migration;
- presentation migration не меняет action ids, permission/detail-level policy или destinations.

## Business truth — не менять presentation refactor

- расход сохраняет контекст room/stage;
- скан чека ведёт в существующий receipt flow;
- ручной расход ведёт в canonical Budget/Expenses;
- contractor work остаётся `CreateWorkSheet`;
- scratchpad остаётся contractor-only по существующей policy;
- chat create сначала получает/проверяет current inbox и использует `createProjectChat`;
- failure остаётся observable через существующий `reportError`/user feedback;
- work post-create refresh failure не отменяет уже созданную работу.

## Verification

- existing `clarityWaveB.w154.test.ts` требует shared sheet chrome и press feedback;
- existing FAB action-policy tests должны сохранить action ids;
- `typecheck:mobile` и relevant mobile tests должны быть green;
- изменение presentation не даёт дополнительного backend/provider readiness credit.
