# Renova — архитектурный аудит

Дата начала: 11 июля 2026
Ветка аудита: `develop`
Статус: этап 1 — архитектура и структура проекта

## 1. Состояние веток

- `develop` опережает `main` на 77 коммитов.
- `feature/task-18` объединена с `develop` через PR #1.
- Основная актуальная интеграционная база — `develop`.
- `main` пока не содержит последние изменения и не должен использоваться как источник текущего состояния продукта.

## 2. Подтверждённые архитектурные проблемы

### A-01. Три параллельных offline-механизма

Критичность: High

Статус: **частично устранено 15 июля 2026** — canonical `offlineQueue` (`renova_offline_queue`); outbox/sync — façade; legacy keys мигрируют; OfflineSyncStatus читает ту же очередь; flush policy 409/4xx/5xx.

Одновременно существуют:

1. `apps/mobile/lib/offlineQueue.ts`
2. `apps/mobile/lib/offline/offlineSync.ts`
3. `apps/mobile/lib/offline/outbox.ts` + `apps/mobile/lib/offline/sync.ts`

При этом корневой layout запускает `flush()` из `offlineQueue.ts`, а новый UI `OfflineSyncStatus` использует другой механизм — `offline/outbox + sync`.

Последствия:

- пользовательский индикатор может показывать не ту очередь, которую реально синхронизирует приложение;
- разные ключи AsyncStorage;
- разные структуры mutation;
- разные правила retry/conflict handling;
- риск потери изменений и ложного статуса синхронизации.

Решение:

- выбрать один canonical offline engine;
- перенести conflict handling и NetInfo lifecycle в него;
- мигрировать старые ключи AsyncStorage;
- удалить два неиспользуемых слоя после миграции;
- добавить тесты offline replay, 409 conflict, 4xx permanent failure, 5xx retry.

### A-02. Неправильная регистрация вложенных contractor-маршрутов

Критичность: High

Статус: устранено 11 июля 2026.

Файлы маршрутов уже корректно зарегистрированы в `apps/mobile/app/(contractor)/_layout.tsx`, но те же экраны дополнительно объявлялись в корневом `app/_layout.tsx` как `(contractor)/...`.

Устранение:

- удалены дублирующие declarations из root Stack;
- canonical registration оставлена внутри contractor group;
- commit: `19fd6f9e248758578e2ff7d533a601fa23656b86`.

Остаточная проверка:

- запустить Expo web и native;
- проверить переходы `subscription`, `audit`, `admin`, `team-qr`, `admin-dashboard`;
- убедиться, что warnings исчезли.

### A-03. Два источника истины для прогресса работ

Критичность: High

Статус: **частично устранено 15 июля 2026** — WorkScheduleSummaryCard разделяет план (график) и факт (этапы); без плана не показывает «0% работ».

KPI «Сроки» использует `ProjectOsSnapshot.schedule` и состояние завершённости проекта.
Карточка `WorkScheduleSummaryCard` использует отдельную сущность `WorkSchedule`.

Если проект завершён, но отдельный график не создан:

- KPI показывает `100% / работы завершены`;
- карточка графика показывает `Не создан / 0%`.

Последствия:

- пользователь получает взаимоисключающие статусы;
- непонятно, какой модуль является главным источником прогресса;
- риск разных отчётов в dashboard, calendar и work schedule.

Решение:

- определить canonical progress source;
- Work Schedule использовать как план, Stage — как фактическое исполнение;
- на главной показывать фактический прогресс этапов;
- отсутствие графика отображать как отсутствие планирования, а не как 0% выполнения;
- синхронизировать карточку Work Schedule с фазой проекта.

### A-04. Новые экраны существуют, но навигационная иерархия не завершена

Критичность: Medium

Есть маршруты:

- `/work-schedule`
- `/finance-center`
- `/quality-control`
- `/work-acceptance`
- `/manager-dashboard`
- `/notifications`

Часть доступна только из скрытого блока Home или прямой ссылки. В dock и основном меню нет ясной структуры доступа.

Последствия:

- функциональность трудно обнаружить;
- страницы выглядят как WIP/служебные;
- разные роли получают непоследовательную навигацию.

Решение:

- не добавлять все экраны в dock;
- сформировать единый раздел «Управление проектом» или contextual navigation;
- оставить dock максимум из 5 основных пунктов;
- добавить role-aware меню с доступом к вторичным центрам;
- скрыть незавершённые экраны feature flag, если они не готовы.

### A-05. Backend router централизован, но перегружен

Критичность: Medium

`backend/app/api/v1/router.py` импортирует и регистрирует большое количество доменных роутеров в одном файле.

Положительно:

- новые `work_acceptances`, `documents`, `project_work_schedule` зарегистрированы;
- параллельной схемы регистрации не обнаружено.

Риски:

- единая длинная строка импортов;
- сложно визуально контролировать дубли prefix/tag;
- слабая группировка по доменам;
- рост вероятности конфликтов при параллельной разработке.

Решение:

- разбить регистрацию по доменным группам: core, project execution, finance, content, admin;
- добавить smoke-test уникальности routes;
- не менять URL API при рефакторинге.

### A-06. Граница development / production не закреплена конфигурацией

Критичность: High

README описывает backend как FastAPI + PostgreSQL, однако фактическая конфигурация по умолчанию использует SQLite и локальный `public_base_url`. При каждом старте backend выполняет `Base.metadata.create_all`, SQLite compatibility patch и seed demo-пользователей/статей.

Последствия:

- локальный режим легко случайно перенести в staging/production;
- схема базы может изменяться вне Alembic migration workflow;
- demo-данные создаются автоматически без явного feature flag;
- TestFlight не сможет работать с локальным `127.0.0.1`;
- поведение SQLite и PostgreSQL может расходиться.

Решение:

- ввести обязательные профили `development`, `test`, `staging`, `production`;
- запрещать SQLite, demo seed и `create_all` вне development/test;
- сделать `PUBLIC_BASE_URL`, `DATABASE_URL`, CORS origins обязательными для staging/production;
- запускать миграции Alembic отдельно до старта приложения;
- добавить startup validation с понятной ошибкой конфигурации.

### A-07. Нет единого реестра публичных, служебных и WIP-экранов

Критичность: Medium

Customer и contractor tabs имеют четыре канонических раздела:

- Главная;
- Объект;
- Ремонт;
- Бюджет/Деньги.

Остальные tab-routes зарегистрированы с `href: null` и открываются программно. Дополнительно существуют глобальные secondary routes и отдельные центры.

Риск:

- разработчик не видит, какой экран считается частью продукта, какой служебный, а какой WIP;
- новые функции легко остаются недостижимыми;
- один и тот же сценарий может получить несколько входов и разные названия.

Решение:

- создать typed registry экранов;
- для каждого route задать `audience`, `visibility`, `entryPoint`, `status`;
- навигационные меню строить из registry, а не из разрозненных массивов и прямых `router.push`;
- добавить тест, что production routes имеют хотя бы один entry point.

## 3. Реестр Mobile routes — первый проход

### 3.1 Канонические tabs для обеих ролей

| Route | Customer | Contractor | Статус |
|---|---:|---:|---|
| `index` | да | да | основной |
| `object` | да | да | основной |
| `repair` | да | да | основной |
| `budget` | да | да | основной |

### 3.2 Скрытые tab routes

Customer:

- `works`
- `materials`
- `control`
- `more`
- `stages`
- `finance`
- `estimate`
- `chat`
- `profile`
- `rooms`
- `calendar`
- `guide`
- `plan`

Contractor:

- `works`
- `materials`
- `control`
- `more`
- `objects`
- `plan`
- `money`
- `stages`
- `estimate`
- `chat`
- `profile`
- `rooms`
- `calendar`

### 3.3 Глобальные secondary routes

Подтверждены в root Stack:

- onboarding;
- wizard;
- room detail;
- stage detail;
- chat thread;
- article;
- contractor wizard;
- job leads;
- portfolio;
- reports;
- design;
- approvals;
- activity;
- documents;
- conflicts;
- scan receipt.

### 3.4 Contractor group routes

Подтверждены внутри contractor layout:

- subscription;
- articles-admin;
- audit;
- admin;
- team-qr;
- admin-dashboard.

### 3.5 Новые standalone centers

Файлы существуют, но пока требуют формального включения в route registry:

- work-schedule;
- finance-center;
- quality-control;
- work-acceptance;
- manager-dashboard;
- notifications.

## 4. Что в архитектуре уже хорошо

- monorepo разделён на `backend`, `apps/mobile`, `packages`, `scripts`, `docs`;
- mobile API собран через единый `apps/mobile/lib/api/index.ts`;
- backend API использует единый `api_router`;
- новые подсистемы Work Acceptance, Documents и Work Schedule имеют backend + mobile client + screens;
- логика оплаты вынесена в сервисный слой;
- есть E2E smoke для критического потока приёмка → оплата;
- тема и UI-компоненты частично централизованы;
- `develop` теперь является актуальной интеграционной веткой.

## 5. Предварительная оценка этапа 1

| Область | Оценка | Комментарий |
|---|---:|---|
| Структура monorepo | 8/10 | Основа хорошая |
| Разделение backend-слоёв | 7/10 | Есть API/services/models, но router перегружен |
| Mobile architecture | 7/10 | Хорошее разделение, но navigation registry отсутствует |
| Единый источник данных | 6/10 | План vs факт разделены на главной |
| Offline architecture | 6/10 | Один storage key; façade UI; тесты policy |
| Навигационная архитектура | 6/10 | Один дефект устранён, но secondary routes не формализованы |
| Environment boundaries | 4/10 | Dev-режим недостаточно отделён от staging/production |
| Общая архитектурная готовность | 68% | Offline + progress частично закрыты; дальше env + documents + route registry |

## 6. Следующие проверки этапа 1

- проверить достижимость каждого standalone center;
- поиск дублирующихся API clients/types;
- проверка моделей WorkAcceptance/Stage/Payment/Document;
- проверка циклических импортов и прямых вызовов инфраструктуры из UI;
- безопасный план объединения offline-слоёв;
- проверка feature/task-19…task-24 относительно актуального develop.

## 7. Правило аудита

Каждый вывод должен быть подтверждён актуальным кодом ветки `develop`. Подготовленное, но не записанное изменение не считается выполненным.
