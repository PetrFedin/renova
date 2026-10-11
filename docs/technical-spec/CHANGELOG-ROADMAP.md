# Renova — журнал изменений и план завершения продукта

**Срез:** 2026-09-08, `main` `95dd4a8e117289df11e1300891490768c22f585f`.
**Статус:** `BLOCKED_FOR_BROAD_PRODUCTION`.
**Полный аудит:** `PRODUCT-COMPLETENESS-AUDIT-2026-09-08.md`.
**Историческая редакция:** `history/CHANGELOG-ROADMAP-before-2026-09-08.md`; её очередь работ не является текущей.

Канон: **наблюдение → решение → код/данные → тест → evidence → следующий шаг**.
Каждая строка исправления требует одного bounded PR и обновления соответствующего ТЗ; оформление UI не отделяется от прав, ошибок и восстановления.

## 1. Уже интегрировано, но не равно полной готовности

| Изменение | Репозиторное доказательство | Что этим не закрыто |
|---|---|---|
| #288 локальный runtime/агентский контекст | Merge7bd1dceb273a7e1f26ddf2333e9199d8d498ae54 | Внешний staging/production. |
| #290 logical restore | Run33344103969, merge748ed5f22db0bfe18001f276ec521d0198d4dc57 | Managed backup/PITR, измеренный RPO/RTO. |
| #292 обычные сообщения чата | Merge9d3f96bad6138aef7f7db32407162fe07897572d | Chat task/invoice/reaction, native export, external storage. |
| #295 гарантийное создание | Merge9fed24c1b59d767daef4d6395fd01cb303c838e3 | Весь post-closeout/provider сценарий. |
| #297 manual payment evidence | Merge389f35d819dbf0b81d2e821da851fa9a647705d2 | Любой источник платежей вообще; S3 ambiguity. |
| #309/#310 supply readiness и явный start | w20materialsupply01 | Multi-contractor и granular partial delivery/payment acceptance. |
| #311 price provenance | Merge85f8d279d393b42bae5d76fea333f9d13c8ae0b5, w21materialprice01 | Цена поставщика не становится вечной офертой. |
| #312 participant foundation | Merge38657631348ea7bbe9a22cd5d631cb4ddba0250e, w22projectparticipants01 | Полный #300. |
| #313 management + atomic lead conversion | Headae8a0750bb6cc788c9e93a1f85a7355f3b180380; CI34262996030; PostgreSQL34262996112; merge65ddb7e59e6bcb23473b1017686cd3adbd882187 | Scoped domain/mobile adoption, legacy writers/quota/source transitions. |
| #314 quoted-lead wizard recovery | Head6e88a1d15883964b1c3f4f0a0f203fb6ef2f0817; CI34264654118; merge95dd4a8e117289df11e1300891490768c22f585f | Общий #315, cold-start discovery, dedicated device E2E. |

## 2. Текущие продуктовые приоритеты

| Очередь | Задача / владелец функции | Закрываемый результат | Обязательное доказательство |
|---|---|---|---|
| P0 | #316 backend+mobile | Повтор первого POST не создаёт второй счёт/работу/набор связей | Response-loss и PostgreSQL same-key race, один atomic commit. |
| P1 launch-blocking, параллельно P0 | #315 mobile/session security | Старый аккаунт не публикует state/token/cache и не исполняет очередь как новый | A→B→A, shared-project actors, delayed refresh/load/flush, token+storage fences. |
| P1 после/вместе #316 | #317 mobile transport | Нормализованная сетевая ошибка достигает правильной очереди; кэш не выдаётся за свежий | Реальные req→producer→storage→flush; 4xx/timeout/cancel; per-resource freshness. |
| P1 | #318 finance+mobile/backend | Части плана сходятся с целым; неизвестный факт не нулевое отклонение | Консервативное округление, 28–31 день, category ledger, timezone. |
| P1 | #319 backend/data lifecycle | Удаление непустого проекта согласовано с participant/evidence/retention графом | PostgreSQL full graph, hold/refusal, rollback, restore и S3 recovery. |
| P1 | #320 mobile files | Кнопка выдаёт native PDF/share результат | iOS/Android+web, auth/session, cancel/cleanup и содержимое файла. |
| P1 | #305 mobile/product | Успешная операция не становится «не сохранено» из-за refresh; единый UI | Commit-success + sync-failure, role/error/empty/stale/accessibility матрица. |
| P1 после session boundary | #300 backend+mobile/product | Заказчик и независимые подрядчики проходят один реальный ремонт с изоляцией | G03, scoped reads/writes/payees/documents/chat, no sibling IDOR. |
| P1 отдельный поток | #238 integrations/operator | Неопределённый ответ провайдера восстанавливается без дублирования/выдуманного успеха | Authoritative provider read, retries/DLQ/replay, внешний evidence. |

## 3. Внешние работы выполняются параллельно, а не после всех экранов

#247: реальная защита main/required checks и отрицательная проверка обхода; владелец repository administration.
#233: постоянный staging с TLS/DNS/managed dependencies и exact-artifact promotion; владелец DevOps/SRE.
#235/#283: ingestion→alert→delivery→ACK→recovery; владелец observability/on-call. Старый draft #283 обновить на актуальной базе отдельным PR.
#234: managed backups/PITR, сохранённый restore drill и измеренный RPO/RTO; владелец DB/SRE.
#236: authenticated smoke/ramp/spike/soak и деградация; владелец performance/SRE.
#256/#257/#237: доступы, независимый pentest и внешнее security acceptance; владелец security/repository owner.
#241: controlled pilot, telemetry, support/incident runbook, legal/privacy approval; владелец product/operations с соответствующими специалистами.

Роли владельцев указаны как требуемая ответственность, не как подтверждённое назначение конкретного человека. Ни один внешний блокер не закрывается только репозиторным CI.

## 4. Приёмка полного продукта

G01 самостоятельный ремонт; G02 один подрядчик; G03 независимые подрядчики; G04 нестабильная связь; G05 смена аккаунта; G06 финансовая сверка; G07 документы/подпись/native-файл; G08 сдача/гарантия/архив/purge; G09 эксплуатационный инцидент; G10 small-screen/accessibility/deeplink. Определения и ожидаемые результаты находятся в полном аудите.

Для каждой функции зафиксировать requirement ID → entry route → role → API/service → authoritative entity → transaction/idempotency → side effect → read/UI → test ID → exact run/artifact. Пустой test/evidence — непроверенная функция, не DONE. Source contract не заменяет поведенческий тест.

## 5. Исторические контрольные заголовки

Следующие заголовки сохранены для совместимости source-contract и исторической прослеживаемости. Они не возвращают уже исправленные проблемы в активную очередь.

### P0.1. Закрыть canonical local runtime end-to-end
DONE в пределах #288/CI; external runtime остаётся отдельным #233.

### P0.2. Полная native PostgreSQL enum parity
w16legacystatus01 → w17chatmessageenum01 → w18nativeenumparity01 интегрированы. Любая новая migration требует новой PostgreSQL/schema qualification; это не вечно зелёный сертификат.

### P1.1. Полный screen contract inventory
ACTIVE: текущий каталог и registry — исходный inventory, а не доказательство прохождения каждого действия. Добавить dynamic/deeplink/role-specific/hidden, native exports и error/recovery состояния. #305/#300/#315/#317/#320.

## 6. Журнал этого аудита

Выявлены и зарегистрированы #316–#320; расширены #315 и #305 конкретными исходными цепочками. Синхронизируются текущий паспорт, roadmap, реестр расчётов, readiness и строгая проверка заголовка схемы. Производственные дефекты этими документами не исправлены; их статус SOURCE CONFIRMED / OPEN. Старые source snapshots сохраняются в history без использования как текущего launch verdict.

Субъективный процент готовности и календарный ETA не рассчитываются без весов требований, принятого release scope, команды и внешних условий. Закрытие реальных приёмочных критериев важнее числа новых функций.

## 7. Дополнение 2026-10-12 — Action Queue v2 (PR #708, Draft)

**Наблюдение:** первоначальный Home Action Queue (#705) сортировал bucket `overdue` перед `mine_now` без учёта `responsible_user_id` и позволял нажать основную карточку, даже если следующее действие назначено другому участнику.

**Решение:** read-only клиентский selector сначала выбирает доступный объект с `responsible_user_id === currentUser.id`, сохраняя bucket-приоритет внутри действий этого пользователя. Если такого объекта нет или viewer в `readOnly`, карточка объясняет ожидание и не вызывает `onOpenItem`. Backend project/scope ACL и canonical action endpoints остаются авторитетными. Классификация API buckets не изменена.

**Source:** `apps/mobile/lib/domain/actionQueuePrimary.ts`, `apps/mobile/lib/domain/actionQueuePrimary.test.ts`, `apps/mobile/components/renova/os/home/ActionQueueCard.tsx`, `apps/mobile/components/renova/os/home/HomeScreenBody.tsx`, `package.json` (`mobile:test`).

**Evidence:** первая проверка PR #708, SHA `e095d5d9a27a6b1e7686b70c8b44b06a2767f022`: CI `38180250280` SUCCESS; mobile-contracts и Playwright SUCCESS; backend **1660 passed / 30 skipped**. Policy `38180250252` FAIL из-за шаблона описания PR; technical-spec `38180250293` FAIL из-за изменившегося `package.json` blob. Этот документ и master dossier обновляются вместе с исправлением шаблона — **новый SHA и повторные проверки обязательны**.

**Граница:** PR #708 остаётся Draft поверх #705; это UI-проекция, не новая capability, не proof фактических device screenshots и не production. #683 независимо заблокирован отсутствующими credentials для обязательного second-agent review (#685). 0 ₽ новых ресурсов; внешние квоты CI отдельно не верифицированы.

## 8. Дополнение 2026-10-12 — Action Queue expandable list (Draft)

**Наблюдение → решение:** одна Home-карточка скрывала остальные уже разрешённые для чтения действия. Добавлен раскрываемый список с фильтрами `Все / Мои / Ожидание`, фильтром по шести серверным категориям, показом по 5 элементов и дальнейшим раскрытием. Список читается только из существующего scoped `ResponsibilityQueue` — без отдельной записи в БД или параллельного источника обязанностей.

**Контракт:** server bucket описывает состояние, а не полномочия. Внутри `getActionQueueRows` собственные назначения идут первыми, затем чужие, приоритет внутри группы стабилен. `getActionQueueRows` дедуплицирует совпадающие `resource_type/resource_id/action`, сохраняет scoped items даже при частичном ответе buckets и поддерживает старый формат API. Пользователь без прав изменения видит только информационные элементы; вызов `onOpenItem` выключен. При переходе всё равно применяются штатные серверные RBAC/ACL.

**Source/test:** `apps/mobile/lib/domain/actionQueuePrimary.ts`, `actionQueuePrimary.test.ts`, `apps/mobile/components/renova/os/home/ActionQueueCard.tsx`. Тест включён в `mobile:test` в предшествующем #708. Проверены роли, фильтры, приоритет, дубликаты, legacy и partial buckets, read-only. Не выдавать исходный код за evidence успешного browser/device UX.

**Статус:** IN CODE / AWAITING exact-head CI, отдельный Draft PR поверх #708, после которого нужны screen/device proof и upstream security admission #683. Новые production-сервисы и расходы не создавались; лимиты GitHub Actions неизвестны.

## 9. Адресные переходы Action Queue — кандидат 2026-10-12

Код: `actionQueueDestination.ts` преобразует только проверенные сочетания resource_type/action в канонические маршруты: платеж → budget/payments?paymentId; замечание → repair/control?issueId; приёмка → repair/control?acceptanceId. Неизвестные сочетания возвращают null. Клиентская навигация не даёт прав на операцию: API экрана и серверный RBAC остаются авторитетными. `OsBudgetScreen` при указанном `paymentId` более не подставляет первый ожидающий платёж, если целевой отсутствует. `CustomerControlView` передаёт acceptanceId в `UnifiedAcceptanceList`, который поднимает нужный элемент списка и выделяет его визуально, но не подтверждает работу автоматически. Добавлен контрактный тест маршрутов в `mobile:test`.

Статус IN CODE, Draft, CI/браузерная приёмка для точного SHA требуются. Никаких финансовых мутаций, новой инфраструктуры, production-деплоя. #683/#685 security admission остаётся блокером выпуска.
