# Renova — конкурентное позиционирование

> Renova — не приложение для ремонта, а **цифровой управляющий ремонтом** и **цифровой паспорт квартиры** от первой идеи до многих лет после завершения.

## Не конкурируем напрямую

| Класс | Примеры | Их сила | Наш ответ |
|-------|---------|---------|-----------|
| ERP подрядчиков | Buildertrend, CoConstruct, Houzz Pro | Глубина для строителя | Клиент — **собственник**, не прораб |
| Стройплощадка | PlanRadar, Fieldwire | Управление объектом | **Помощник владельцу**, не инженерная система |
| Замеры | magicplan | Отличные планы | Замеры — старт, не конец пути |
| Деньги | Joist | Считает деньги | Полный **жизненный цикл** ремонта |
| RU-сметы | ГРАНД-Смета и аналоги | Таблицы | **Продукт + UX**, не бухгалтерия |

## Главная боль рынка

Ремонт размазан по 10+ инструментам: планировщик → Excel → Telegram → банк → фото → заметки → PDF.

**Moat Renova:** всё в одном месте + одно следующее действие.

## 10 опор продукта (implementation map)

| # | Принцип | Реализация в коде |
|---|---------|-------------------|
| 1 | Единая система | `OsHomeScreen`, канонические разделы `osSections.ts` |
| 2 | Decision engine | `ai_insights_service.py`, `OsInsightsStrip` |
| 3 | Следующее действие | `work_snapshot_service`, `room_snapshot_service`, `NextActionHero` |
| 4 | Полный lifecycle | stages → materials → acceptance → payments → archive |
| 5 | AI-анализ (не чат) | Rule-based insights: бюджет %, задержки, блок оплаты |
| 6 | Digital Twin | `room_snapshot_service`, `RoomPassport` |
| 7 | Простота UI | Одна главная кнопка, сворачиваемые детали |
| 8 | Риски | `risk_engine`, `schedule_service`, `RiskStrip` |
| 9 | Автоматизация | `automation_engine.py` — цепочка событий |
| 10 | Паспорт квартиры | Room snapshot сохраняет материалы, чеки, гарантии |

## Автоматизация (цепочка событий)

```
WorkCompleted → InspectionRequested → AcceptancePassed → PaymentAllowed
MaterialCalculated → PurchaseSuggested
MaterialDelivered → DependentWorkUnlocked
PaymentBlocked → NotifyCustomer
ExpenseAdded (≥90% budget) → BudgetAlert
IssueCreated (critical) → NotifyContractor
schedule_overdue → NotifyContractor
```

## Монетизация (roadmap)

1. **Freemium** — 1 проект бесплатно
2. **Plus / Pro / Business** — AI, экспорт, подрядчики, семья
3. **Marketplace affiliate** — материалы без навязывания
4. **Сеть мастеров** — комиссия за лиды
5. **AI Premium** — проверка смет/договоров
6. **Banks & insurance** — ненавязчиво
7. **White Label** — девелоперы, студии, магазины

## Метрики успеха MVP

- Пользователь открывает приложение и видит **одно действие** без размышлений
- Комната = паспорт с работами, бюджетом, материалами
- Copilot даёт ≥1 actionable insight при проблеме
- Оплата блокируется без приёмки (gate работает)

## Work Engine — Глава 4 (этапы)

| § | Требование | Файлы |
|---|-----------|-------|
| 4.3 | 14 стандартных этапов | `calc/estimate.py` STANDARD_RENOVA_STAGES |
| 4.4–4.10 | Dashboard этапа | `work_snapshot_service.py`, `stage/[id].tsx` |
| 4.5 | Вычисляемые статусы | `stage_status_service.py` |
| 4.6 | Работы внутри этапа | `workflow_templates.py` PHASE_TEMPLATES |
| 4.8–4.9 | Вес + прогресс | `weight_coefficient`, `weighted_progress()` |
| 4.11 | Следующее действие | `next_action()` + `POST .../start` |
| 4.12 | Gates закрытия | `completion_check()` |
| 4.18 | Vertical timeline | `RoomStageTimeline.tsx` |
| 4.19 | Auto-advance | `accept_stage()` + automation |
