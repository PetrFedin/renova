# Renova — живое техническое задание и системная спецификация

**Статус документа:** ACTIVE / LIVING SPECIFICATION
**Язык:** русский
**Дата текущей сверки:** 2026-09-08
**Проверенный продуктовый срез:** `95dd4a8e117289df11e1300891490768c22f585f`
**Текущий schema head в этой редакции:** `w22projectparticipants01`
**Текущий verification status:** `SOURCE AUDITED / BOUNDED CI EVIDENCE / FULL PRODUCT ACCEPTANCE INCOMPLETE`
**Широкий production-запуск:** `BLOCKED_FOR_BROAD_PRODUCTION`

`AGENTS.md` — единственный engineering-policy. Этот master — текущий паспорт продукта, контрактов и доказанности. Он не подтверждает все функции по одному факту наличия кода. Предыдущая полная редакция сохранена без изменения содержимого в `technical-spec/history/RENOVA-TECHNICAL-SPECIFICATION-before-2026-09-08.md`: это справочный исторический срез, не текущий порядок работ и не launch verdict. Функциональность из целевого продукта этим переоформлением не удаляется.

Актуальные приложения: [полный аудит](technical-spec/PRODUCT-COMPLETENESS-AUDIT-2026-09-08.md), [план и история](technical-spec/CHANGELOG-ROADMAP.md), [расчёты](technical-spec/CALCULATION-REGISTRY.md), [экраны](technical-spec/SCREEN-CONTRACT-CATALOG.md), [source snapshot экранов](technical-spec/SCREEN-SOURCE-SNAPSHOT.md), [правила сквозного сопровождения](technical-spec/END-TO-END-GOVERNANCE.md). Детальные domain-contract приложения остаются действующими в части реализации; статус их квалификации проверяется по текущим PR/CI и разделу15, а не по старому слову candidate в приложении.

# 0. Правила доказанности и сопровождения

**VERIFIED** — прочитан соответствующий source/config/migration, не автоматически испытан пользовательский результат. **CI VERIFIED** — прошёл конкретный набор тестов конкретного SHA. **LOCAL TESTED**, **STAGING VERIFIED**, **PRODUCTION VERIFIED** не взаимозаменяемы. **PENDING REVERIFY** означает изменение кандидата после доказательства. **TBD / UNVERIFIED** — нет достаточного подтверждения. **HISTORICAL** — старый срез.

Рабочий цикл: требование → источник и полный путь → обнаруженный разрыв → bounded implementation → синхронное ТЗ → тесты → точный SHA/run/artifact → сверка остаточных рисков. Нельзя объявлять READY по красивому экрану, enum, наличию API или одному зелёному CI.

## 0.1. Текущий source snapshot

| Source | Blob SHA | Назначение |
|---|---|---|
| `AGENTS.md` | `767d38e76d04209e609bbe7173a2c448cfc5fa00` | Engineering policy |
| `backend/app/api/v1/router.py` | `8663e5b54289b133c5a2ff30af0533cfee93dfb6` | Реальная composition маршрутов |
| `backend/app/models/entities.py` | `f2e63f316fa8c9b2012894ae4e496dc76a73a3a1` | Базовые entities/enums |
| `backend/app/main.py` | `223e83b13f96398eefe997275ac6f41fa44bfbcf` | API lifespan |
| `backend/app/services/seed_demo.py` | `c62ba920130a7ba7f6e2bd0a54e63feadce5c6cd` | Явный development seed |
| `backend/scripts/verify_orm_schema_parity.py` | `ba08d0681df301f446b3adbf811ad9367eeb24b9` | Schema/ORM parity |
| `backend/scripts/verify_current_migration_schema.py` | `13e63544564b41a13c52f9437b9bfbdfa290913b` | Enum/migration invariants |
| `apps/mobile/lib/routeRegistry.ts` | `0c9a386486f61cd1a284d8bd7fc99368b557232f` | Канонические navigation entries |
| `apps/mobile/constants/Theme.ts` | `6e66c4bf0db8c9d1b8c4a2d0355311145ca43b20` | Theme/touch geometry |
| `apps/mobile/constants/typography.ts` | `8a96b7f290944ac2c566c0f1791c1f60ab90c68a` | Typography |
| `apps/mobile/constants/screenTypography.ts` | `f91c9a659a1ab8603ae4d82eb46d76754627b5bb` | Screen typography |
| `apps/mobile/constants/uiTokens.ts` | `ca2d8e9e03f56efb058041ad8a81c04d15c7a8a0` | Surfaces/chips/inputs |
| `apps/mobile/constants/screenLayout.ts` | `0165f3c86d829311e91ac17b875c23ccaefab12b` | Screen layout |
| `apps/mobile/components/renova/os/OsHubTabs.tsx` | `f480067b06c750623e4091fe0db128c877e3fb37` | Hub tabs |
| `apps/mobile/components/screens/OsObjectHubScreen.tsx` | `3082b1bf59cbf420d403ed82b35bbc2e78697728` | Object hub |
| `apps/mobile/components/screens/OsRepairHubScreen.tsx` | `5fe0e6229ad4cc82462ea4cfc1f7d213c7687305` | Repair hub |
| `apps/mobile/components/screens/OsBudgetHubScreen.tsx` | `4e0e8267d68b600cf0d8bdf716a4c8eddaa3bcbd` | Budget hub |
| `apps/mobile/constants/budgetTabs.ts` | `d02c05560176535e130d76960c2b67691bcbb3b7` | Budget tab canon |
| `.cursor/rules/renova-design-system.mdc` | `2f48e46f5b348b8cbc3a370615a5a5e93d93421f` | UI rules |
| `package.json` | `4c95fcf89d7e29f1c464a7db2c7aa4c85335fe11` | Root commands/test entrypoints |
| `.github/workflows/local-runtime-integrity.yml` | `3ae00fa13be960bf7acba71c8cfa41134d35e16f` | Local runtime proof |
| `backend/alembic/versions/w16legacystatus01_legacy_status_enum_parity.py` | `d2137f2b87c1ac6f679093331bd034aff17c8188` | Legacy status repair |
| `backend/alembic/versions/w17chatmessageenum01_chat_message_enum_parity.py` | `0537268c85e26b7a607d36f967a3402b8bba53c4` | Chat enum repair |
| `backend/alembic/versions/w18nativeenumparity01_remaining_native_enum_parity.py` | `d210b757441efedf7c3e7959ba45321f02962dc4` | Native enum repair |
| `backend/alembic/versions/w19paymentevidence01_manual_payment_evidence.py` | `78b24e27e4499def7254a75e770e863d35f311a6` | Evidence versions |
| `backend/alembic/versions/w22projectparticipants01_project_participant_foundation.py` | `6de2c048fddc7bea5e385eaa80ca8d30fbe4eb3c` | Participants/scopes/audit |
| `docs/technical-spec/CHANGELOG-ROADMAP.md` | `7942b12961d967b39d1f77e98deccc0c301ad9e6` | Текущий план и историческая прослеживаемость |

# 1. Назначение продукта и границы системы

Renova — iPhone-first управление реальным ремонтом, а не демонстрация отдельных экранов. Целевой результат: согласованный объём/бюджет/график, исполненные и принятые работы, обеспеченные материалы, корректные деньги, документы, история и гарантии. Результат должен оставаться правильным при ошибках, повторах, смене устройства/аккаунта и отказе провайдера.

Роли: customer, contractor, team/viewer, technical supervisor, admin/operator. Наличие роли не разрешает действие вне project/resource scope. Независимые подрядчики — целевое обязательное свойство полного продукта; временная недоступность #300 не превращается в отказ от требования.

# 2. Репозиторий и источники истины

Канон `PetrFedin/renova`: main→короткая ветка→PR→применимые проверки→merge. Старые develop/task-ветки не интеграционная база. `CLAUDE.md` и bootstrap Cursor правила указывают на AGENTS.

Навигация: routeRegistry + реальные Expo routes. API: итоговый router + конкретные services. Данные: ORM + линейный Alembic graph, PostgreSQL authoritative. Текущий head `w22projectparticipants01`; w16legacystatus01→w17chatmessageenum01→w18nativeenumparity01→w19paymentevidence01→w20materialsupply01→w21materialprice01→w22projectparticipants01 — продолжение уже потреблённой истории, не инструкция переписывать старые миграции.

Readiness: корневой PRODUCTION-READINESS.md и docs/production-readiness-evidence.json. При конфликте подтверждённого кода с документом исправляется конфликт, а не повышается статус по документу.

# 3. Runtime architecture

Один immutable backend image, два процесса: `renova-api` для HTTP/WebSocket/локального runtime coordination и `renova-worker` для durable outbox/provider/automation/push reconciliation. PostgreSQL хранит правду; Redis — явно определённое общее coordination/rate-limit состояние; S3-compatible storage — приватные файлы. API replica должна быть заменяемой без потери работы.

Local development: Compose `renova-local`, только локальный Docker context, `.env.local` из env.local.example, не staging/production credentials. Команды:

```bash
npm run dev -- doctor
npm run dev -- bootstrap
RENOVA_DEV_NO_EXPO=1 npm run dev
npm run dev -- check
npm run dev -- seed
npm run dev -- test-focused
npm run dev -- test-full
npm run dev -- logs
npm run dev -- stop
```

Bootstrap устанавливает locked зависимости явно; startup не устанавливает их сам. Миграция→preflight→API/worker→health/ready/heartbeat→Expo; ошибка обязательного шага останавливает запуск. Seed явный development-only, повторяемый; двойной seed — испытание идемпотентности, не необходимость вручную дважды инициализировать приложение. Reset разрушителен и ограничен локальным проектом/volumes. Canonical toolchain задаётся AGENTS/lockfiles; его успешный CI не означает наличие такого runtime у конечного пользователя.

# 4. Data/domain model — системная карта

| Контур | Сущности и связи | Неподменяемый смысл |
|---|---|---|
| Identity | User/AuthSession/team/viewer/supervision | Активная сессия, конкретная роль и область права |
| Object | Project→Room/план/design/EstimateLine | Один объект и его исходные параметры |
| Participation | ProjectParticipant→Scope/Event | Независимый principal, явный scope и история; lead compatibility отдельно |
| Execution | Stage→WorkOrder/schedule/dependency/photo/comment | План не факт старта; выполнение не приёмка |
| Procurement | MaterialPick→Purchase/PurchaseItem | Потребность, доступность, закупочная ответственность и историческая цена |
| Finance | Estimate/ChangeOrder, Expense, Payment, Receipt/evidence | Обязательство, расход, движение денег и доказательство не одна сущность |
| Documents | Document/version/signature/retention | Неизменность подписанной версии и политика хранения |
| Communication | ChatThread/Message/Participant/Read, notification/inbox | Разрешённые получатели и authoritative read state |
| Reliability | ClientWriteRequest/DomainOutbox/lease/delivery/provider operation | Повтор, fencing, durable intent, reconciliation |
| Closure | Acceptance/rework/issue/warranty/archive/trash | Сдача результата не то же самое, что архив или физическое удаление |

Project.contractor_id — текущий optional lead, не полная карта подрядчиков. ProjectParticipant не расширяет generic ACL автоматически. Scope/revocation обязаны применяться к чтению, записи, push, file/export и background работе. Новый entity обязан включаться в purge/retention и restore tests; w22 выявил пробел #319.

# 5. Transaction, idempotency, outbox и provider boundary

Целевой invariant: authoritative mutation + audit + DomainOutbox + request ledger фиксируются одной транзакцией одной бизнес-операции. Caller знает границу commit; ошибка refresh/WS/navigation после него не отменяет сохранённый факт.

ClientWriteRequest: scope/project/actor/request-id/canonical payload. Идентификатор появляется до первой попытки сети и сохраняется в offline intent. Same-key same-payload возвращает исходную сущность; другой payload возвращает конфликт; намеренные одинаковые операции могут иметь разные ключи. #316 фиксирует ещё не переведённые chat invoice/task и WorkOrder create. Заголовок X-Offline-Id сам по себе доказательством защиты не является.

Outbox: deterministic intent→worker claim→lease/fencing→provider/local effect→retry/backoff→done либо terminal/DLQ→audited recovery. WS/push — ускорение, authoritative read reconciliation обязательно. Внешний timeout не превращается в безусловный успех или слепой повтор. S3 metadata/PUT/HEAD/orphan требуют отдельного recoverable protocol (#238).

Конкурентное решение проверяет свежую заблокированную/версионную строку, а не уже загруженную identity map. Authorization и business constraints проверяются в границе записи. Старые compatibility writers должны делегировать канону либо безопасно отказывать; наличие нового router не удаляет автоматически внутренний старый вызов.

# 6. API composition

Канонический `/api/v1` объединяет auth/projects/rooms/estimate/budget, stages/work-orders/schedules, materials/purchases/selections, payments/receipts/bank, documents/e-sign/warranty, chat/notifications/automation, technical-supervision, marketplace и operator/admin.

Точная inventory эффективных методов определяется итоговой composition, не просто количеством decorators: существующее `_remove_replaced_routes` убирает shadow legacy handlers. Новые постоянные обходные route-surgery паттерны не вводятся. Любой critical endpoint имеет схему входа/выхода, actor/resource ACL, missing/null semantics, conflict/provider-pending и повторяемый результат.

#313 канонизировал HTTP lead assignment и conversion. API участника: owner-only list/add/reactivate/replace-scope/remove. Его наличие не означает, что независимый подрядчик уже проходит весь ремонт.

GET не должен изменять business truth. Нельзя выполнять скрытое назначение подрядчика как следствие обычного выбора проекта; совместимость текущего loadProject требует отдельного устранения в #315.

# 7. Mobile information architecture and navigation

Dock: Главная, Объект, Ремонт, Бюджет/Деньги, обязательные Сообщения. Сроки — optional/secondary. Меню строится registry с role/phase/readOnly и ограничением More, не ручными дублями. Registry ga/beta — metadata навигации, не сертификат полной приёмки.

| ID | Канонический путь / назначение |
|---|---|
| home | /index, главная |
| object | /object, объект |
| repair | /repair, ремонт |
| budget | /budget, деньги |
| calendar | /calendar, сроки |
| chat | /chat, сообщения |
| manager-dashboard | /manager-dashboard, сводка, phase-aware |
| finance-center | redirect budget/payments + payment sheet |
| control | redirect repair/control |
| quality-control | /quality-control, contractor deeplink |
| work-acceptance | redirect repair/control |
| work-schedule | redirect calendar |
| documents | /documents |
| approvals | /approvals |
| notifications | redirect inbox |
| inbox | /inbox |
| scan-receipt | /scan-receipt |
| stage | /stage/[id] |
| materials-procurement | repair/materials/purchases |
| selections | repair/selections |
| warranty-claim | documents, затем роль/claim |
| design | redirect object/plan/sub=design |
| conflicts | /conflicts, offline conflict |
| portfolio | /portfolio |
| scratchpad | /scratchpad |
| budget-planner | /budget-planner |
| checklist-templates | /checklist-templates |
| guide | /guide |
| activity | /activity |
| portal | /portal?token=, вход по ссылке |
| reports | /reports |
| project-analytics | redirect budget/deviations |

Это registry inventory, не все физические screens/sheets/динамические состояния. Дополнительный полный экранный inventory и требования приёмки остаются обязательными. Deeplink повторно проверяет session/role/project/entity access, не доверяет сохранённому activeProject.

# 8. Hub screens — состав, переходы, badges и progressive disclosure

Object: `rooms`, `estimate`, `plan`, `profile`. Repair: `works`, `materials`, `selections`, `control`. Budget: `summary`, `expenses`, `payments`, `deviations`. Materials: picks→потребности, purchases→закупки, receipts→чеки. Основные role groups используют общие Os* компоненты и server capabilities, не две независимо расходящиеся системы.

Каждый hub показывает loading/empty/error/stale/success отдельно. Отсутствие ответа не означает ноль, прочитанный cache не означает свежие данные, raw error не пользовательское объяснение. Badge обязан иметь определение/источник/as-of и совпадать с детальной очередью.

Gates для UI: недоступность действия объяснима; один основной следующий шаг; после commit допускается частично успешное состояние с восстановлением. #305 включает подтверждённый ложный отказ в материалах. #315/#317 ограничивают доверие к общему context и freshness; эти gaps нельзя скрыть дизайном.

# 9. UI design system — точные токены

Источники: Theme/typography/screenTypography/uiTokens/screenLayout и `.cursor/rules/renova-design-system.mdc`.

| Token | Значение |
|---|---|
| primary | `#334155` |
| accent | `#2563EB` |

Minimum touch target: **44 px** (документальный контракт; проверка реальной touch area отдельно).

```text
display 32
hero    24
h1      22
body    14
```

Общие Card, PrimaryButton, StatusPill, SectionHeader вместо местных параллельных компонентов. Семантика primary/outline/ghost/danger стабильна. Spacing и radius берутся из токенов, операционные иконки — из единого семейства, не случайных emoji. Для action sheet: busy/disabled/keyboard/cancel/error, длинные русские подписи, scale текста и safe area. Скрытая beta-функция не считается выполненным release-требованием.

Pixel-perfect/контраст/physical-device состояние всего приложения в аудите не подтверждено. Требуется матрица screenshot/device сценариев, включая отказ, offline и частичный успех.

# 10. Основные business flows и связи

## 10.1. Проект
Новый customer→реальные параметры/комнаты→проект/смета/этапы→открытие объекта. Atomic creation/ClientWriteRequest существуют; один успешный POST не доказывает корректную дальнейшую навигацию. Marketplace: lead→quote acceptance→atomic conversion→один project. #313/#314 исправлены; source transitions/cold-start recovery ещё проверяются.

## 10.2. Участники и исполнение
Заказчик задаёт principals/scopes; назначение work/stage не разрешается постороннему. Stage start явный, material readiness не создаёт start fact. Execution→review→customer accept либо reject→rework→повторная приёмка. Payee, recipient set, contracts и надзор следуют соответствующим полномочиям. #300 остаётся незавершённым сквозным контуром.

## 10.3. Снабжение
Сметная потребность→источник снабжения/кто закупает→одобренная цена/количество→Purchase→оплата/поставка→quantity availability→готовность этапа. Число одобренных строк не равно обеспеченному количеству. Историческая неизвестная цена quarantined, supplier live price не заменяет вручную подтверждённую коммерческую договорённость без правил обновления.

Purchase partial — частичная оплата в текущем lifecycle; returned — возврат после delivered. Наличие этих статусов не доказывает весь частичный денежно-количественный учёт. Обязательны сценарии split delivery, damaged/returned qty, independent refund и reconciliation; точные пробелы устанавливаются тестом и source trace.

## 10.4. Финансы
Estimate — план; ChangeOrder — согласованное изменение; Purchase — закупка; Expense — признанный расход; Payment — движение/состояние оплаты; Receipt/evidence — доказательство; Refund — обратная операция. Одно событие не повышает spend дважды через чек+платёж+закупку.

#297: upload intent→versioned private evidence→submit→approve/reject/resubmit→confirmed Payment→единственный Expense. Это ограниченный CI-проверенный путь. Не распространять его идемпотентность на chat invoice (#316) или недоказанную внешнюю доставку (#238).

## 10.5. Коммуникация
Обычное сообщение имеет request-id, atomic message/visibility/outbox и reconciliation. Чатовые бизнес-действия требуют собственной атомарности; task/invoice пока #316. Read определяется серверным cursor после реальной видимости, equal-timestamp precision #271. Attachment/native transcript экспорт — отдельные #238/#320.

## 10.6. Документы
Загрузка→проверяемый файл→версия→согласование/подпись→скачивание/история/retention. Metadata classification не OCR содержимого. Госключ недоступен; live Контур не доказан. Pending подписания не signed, локальная подпись в приложении не автоматически доказательство юридической эквивалентности любой внешней подписи.

## 10.7. Завершение
Closeout проверяется по работам/замечаниям/документам/деньгам; пользователь получает итоговый комплект. Warranty create #295 квалифицирован, но полный closeout→claim→fix→customer closure нуждается в сквозной приёмке. Archive/trash/restore/purge — отдельные состояния, #319 для непустого графа и retention.

## 10.8. Ошибки и идентичность
Весь путь сохраняет владельца намерения: аккаунт/сессия/проект/request-id. При commit+потере ответа нельзя создавать новую сущность; при commit+ошибке UI нельзя объявлять запись неуспешной. Нельзя отправлять очередь A с токеном B. Нормализованные transport errors обязаны быть совместимы с offline producers.

# 11. Calculations and derived state

Детали — CALCULATION-REGISTRY. Подтверждённый spend формируется из confirmed Expense; UI tolerance не меняет ledger. Бюджет, cash, obligation, estimate и forecast различаются. Даты/валюта/округление/статусы/возвраты/пропуски обязательны в каждой формуле.

Материалы используют quantityToBuy/material_available, не старые status-only счётчики. Периодные суммы должны быть консервативными; текущий /4 при пяти buckets — #318. Works/waste/reserve в portfolio не обладают отдельным фактом только потому, что вход подставлен в plan и spent. Нулевое отклонение при неизвестном факте запрещено как аналитический вывод.

Неполный реестр вычислений остаётся реальным backlog. Настоящий progress/phase/attention нельзя доказать одним числом на Home; сверять producers, statuses и реальный user result.

# 12. Security, privacy и boundaries

Fail-closed auth/ACL, session revocation, horizontal/sibling IDOR, private uploads, operator RBAC, webhook validation, secrets redaction, locked dependencies и supply-chain checks остаются обязательными. #315 относится к actor/session integrity всей мобильной цепочки, а не только очистке экрана.

Data export/deletion должны соответствовать явно утверждённому scope/retention; экспорт профиля и списка проектов не называется полным архивом всех материалов ремонта. Наличие repository security scans не external security sign-off. #247/#256/#257/#237 открыты.

# 13. Release и эксплуатационная готовность

Image identity: Git SHA→immutable sha-tag→OCI revision→registry digest→deployed digest. Mobile: Git SHA+app0.3.7+native build3+реальные EAS/build IDs. Source app.json не магазинная публикация.

Постоянный staging, live provider, managed PITR/restore, внешний alert/ACK, нагрузка и pilot не доказаны в этом аудите. Targets RPO≤15min/RTO≤60min и latency/error-rate SLO — цели, пока нет измерений. Не называть внешний сервис отсутствующим лишь потому, что evidence не предоставлен.

# 14. Tests and verification matrix

| Проверка | Что доказывает | Чего не доказывает |
|---|---|---|
| Source/hash/route/header contracts | Соответствие заявленного snapshot/структуры | Корректность каждого business outcome |
| Unit/service tests | Проверенные ветви и invariants | Все взаимодействия живых ролей/устройств |
| PostgreSQL races/migrations | Проверенные locks/constraints/upgrade | Любые другие writers и всю production-нагрузку |
| API E2E | Проверенную последовательность HTTP/БД | Наличие пригодного native UI |
| Surface Playwright | Видимость/переход/ошибки конкретных поверхностей | Нажатие каждого CTA и полный ремонт |
| Native/device acceptance | Пройденный build/платформу/сценарий | Все будущие build/провайдеры |
| External drills | Указанный артефакт/среду/операцию | Вечную production-готовность |

Full acceptance G01–G10 задана в аудите. В этом проходе она НЕ выполнена. Последние bounded qualification: #313 full CI34262996030 и PostgreSQL34262996112; #314 full CI34264654118. Новый audit PR требует своих применимых gates. JSX exemptions и dependency exceptions не скрываются и не расширяются ради green.

# 15. Независимые критические PR-контуры

| Контур | Текущая правда |
|---|---|
| #282 | Исторический chat lineage, интегрирован successor #292; не merge повторно |
| #284 | Исторический DR lineage, successor #290; managed DR #234 открыт |
| #287 | Исторический warranty lineage, successor #295; не текущая следующая работа |
| #286 | Исторический local-runtime lineage, successor #288 |
| #283 | Старый observability draft; обновить отдельно; внешний #235 не закрывается кодом |
| #311/#312 | Merged price provenance/participant foundation |
| #313 | Merged65ddb7e59e6bcb23473b1017686cd3adbd882187 после квалификации ae8a075 |
| #314 | Merged95dd4a8e117289df11e1300891490768c22f585f после квалификации6e88a1d |

# 16. Known gaps / improvement backlog

Активные конкретные findings F01–F12 и источники — полный аудит. Первый продуктовый приоритет #316 и #315; затем #317, финансовая аналитика #318, lifecycle #319, native #320 и truthful interaction #305. #300 — полноценная многоподрядность, #238 — provider/storage recovery. Эксплуатационный поток #247/#233/#235/#234/#236/#256/#257/#237/#241 идёт отдельно/параллельно.

Зафиксировать additional acceptance без ложного утверждения «этого нет»: детальный план/дизайн, partial payments/delivery/refunds, bank matching, content OCR/подпись, отчёт/closeout, все notification counters, справка, native permissions/accessibility. Нет полного теста — непроверенный результат, не автоматически отсутствующая реализация.

# 17. Traceability matrix

| Требование | Источник/контракт | Тест/evidence/остаток |
|---|---|---|
| Сессия/очередь | client.ts, RenovaContext, offlineQueue | #315/#317; G04/G05 |
| Create/convert | project_create_service, marketplace_conversion_service | #313; G01/G02 |
| Participant/scope | PROJECT-PARTICIPANT-SCOPE-CONTRACT | w22projectparticipants01, #312/#313; #300/#319 |
| Снабжение/цена | MATERIAL-SUPPLY-CONTRACT, MATERIAL-PRICE-TRUTH-CONTRACT | #310/#311; G03/G06 |
| Evidence/Expense | MANUAL-PAYMENT-EVIDENCE-CONTRACT | #297; #238, G06/G07 |
| Chat create | CHAT-ATOMICITY-CONTRACT | #292; бизнес-действия #316 |
| Warranty | WARRANTY-ATOMICITY-CONTRACT | #295; G08 |
| Wizard recovery | MARKETPLACE-WIZARD-RECOVERY-CONTRACT | #314; #315 и targeted E2E |
| Формулы | CALCULATION-REGISTRY | #318 и непокрытые producers |
| Экран/действие | SCREEN-CONTRACT-CATALOG, routeRegistry | #305/#320; G10 |
| Current schema/status | master+readiness+Alembic graph | Strict explicit-header check; не substitutable annex mention |
| Production | readiness evidence | Внешние gates остаются open |

# 18. Documentation Definition of Done

Изменение считается сопровождаемым, когда requirement/result, реализация, роли, failure/retry/concurrency, schema, side effects, UI, тест и статус одного exact candidate связаны. Source SHA без семантической сверки недостаточен. Исторический полный текст сохранён; повторно использовать из него старый next-step/schema/head нельзя.

Запрещено закрывать issue по ограниченному foundation, выдавать audit report за runtime test, сохранять неизвестные показатели как 0, обозначать promised-but-disabled capability как DONE либо выводить срок запуска без согласованного ресурса и внешних условий. Аудит синхронизирует план; F01–F10 всё ещё требуют продуктовых исправлений.
