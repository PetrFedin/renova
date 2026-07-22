# Chat read receipts: foreground guard

Read receipt отражает **реальный просмотр**, не техническую доставку.

## Gate

`useScreenVisibility()` + `evaluateMarkReadAllowed()`:

- `appState === 'active'` (iOS `inactive` / background — нет)
- web: `document.visibilityState === 'visible'`
- React Navigation focus
- `activeThreadId === routeThreadId`
- `threadContentReady` (loaded + access + painted)
- нет overlay/modal
- пользователь залогинен, экран смонтирован

## Background

1. `screenVisibilityService` сразу ставит `appForeground=false` (до React re-render).
2. `activeThreadContext` патчится синхронно — WS не suppress / не mark-read.
3. Локальный unread **не** обнуляется; новые сообщения сохраняются и bump'ятся.
4. После возврата: reconcile thread sync → mark-read только на ребре visible `false→true`.

## Push

- Получение push ≠ read.
- Тап по push открывает тред (`resolvePushLink` → `/chat/[threadId]`).
- Mark-read — только после успешной загрузки и visible gate.

## API

- `lib/domain/screenVisibility.ts` — чистая политика
- `lib/screenVisibilityService.ts` — AppState + document
- `lib/hooks/useScreenVisibility.ts` — React hook
- `markThreadRead` пропускает auto-sources в background (`skipped_background`)

Тесты: `npm run test:chat-read-foreground`
