# W77 — интеграции без платежей (2026-07-20)

Связки: **бейджи задач ≠ чат**, **inbox ← очереди W76** (ДО / гарантия / подписи / WA у исполнителя).

## Что сделано

### 1. IA шапки «Ещё»
- Иконка `menu-outline` (не путать с chatbubble).
- Бейдж **янтарный** = только `taskBadge` (оплаты, приёмка, ДО…).
- Чат остаётся **красным** на dock «Сообщения».
- В меню у «Входящие»: hint «N в Сообщениях», если есть unread.
- a11y: `moreMenuA11yLabel` — явно «задачи» vs «непрочитанные в сообщениях».

### 2. Inbox = те же очереди, что nextAction (W76)
- Заказчик: pending ДО, открытая гарантия, draft-документы на подпись.
- Исполнитель: `acceptancesPendingCount` (не только `stage=review`) + ожидание ДО.

### 3. Dock
- a11y «Сообщения, N непрочитанных» при unread > 0.

## Тесты
- `apps/mobile/lib/domain/moreMenuA11y.w77.test.ts`
- `buildInboxItems.test.ts` — warranty/CO в taskBadge

## Вне скоупа
H0 secrets, live YuKassa, CI workflow OAuth.
