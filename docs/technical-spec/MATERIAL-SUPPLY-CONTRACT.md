# Контракт источника и ответственности материалов

**Статус:** PENDING EXACT-HEAD CI  
**Связанный issue:** #298  
**Schema head:** `w20materialsupply01`  
**Назначение:** нормативный annex к `docs/RENOVA-TECHNICAL-SPECIFICATION.md` для канонической истины «кто обеспечивает материал, сколько уже доступно и сколько действительно требуется купить».

## 1. Каноническая запись

Единственным material master для этого контура остаётся `MaterialPick`. Новый параллельный material/purchase model не создаётся.

`MaterialPick` дополнен двумя migration-owned полями:

- `supply_source VARCHAR(32) NOT NULL` — источник и сторона, ответственная за обеспечение;
- `qty_available FLOAT NOT NULL` — физически доступное количество вне поставок, уже проведённых через Renova Purchase.

Допустимые `supply_source`:

| Значение | Смысл | Создаётся Purchase |
|---|---|---|
| `customer_on_hand` | всё требуемое количество уже есть у заказчика | нет |
| `customer_to_buy` | недостающее покупает заказчик | да, только заказчик |
| `contractor_to_buy` | недостающее покупает назначенный исполнитель | да, только назначенный исполнитель |
| `contractor_included` | материал обеспечивает исполнитель в составе работ | нет |
| `third_party` | материал обеспечивает внешняя сторона | нет |

PostgreSQL CHECK запрещает неизвестные источники и `qty_available < 0`. ORM и Alembic используют ту же физическую таблицу `material_picks`; PostgreSQL native enum намеренно не вводится.

## 2. Количественная истина

Для каждой позиции:

```text
required_qty = qty_needed, если оно задано, иначе qty
physical_available = max(qty_available, 0) + max(qty_delivered, 0)
qty_to_buy = max(required_qty - physical_available, 0) только для *_to_buy
qty_to_buy = 0 для customer_on_hand / contractor_included / third_party
material_available = physical_available >= required_qty
```

`customer_on_hand` означает полное наличие: `qty_available` должно покрывать `required_qty`. Сценарий «3 уже есть, 7 докупить из 10» моделируется как `customer_to_buy + qty_available=3`, а Purchase создаётся только на 7.

Legacy `purchased` rows без исторического `qty_delivered` остаются совместимыми: supply calculation не превращает ранее завершённые позиции в ложный дефицит.

## 3. Согласование, readiness и audit

Физическое наличие не отменяет customer approval.

Material dependency считается удовлетворённой только когда одновременно:

1. `MaterialPick.status ∈ {approved, purchased}`;
2. `physical_available >= required_qty`.

Частичная поставка не разблокирует этап. Доставка или изменение наличия только пересчитывает dependency truth и **никогда не переводит Stage в active** — explicit canonical start gate из #308 остаётся единственным источником execution truth.

Изменение `supply_source` или `qty_available` после `approved`:

- возвращает материал в `pending`;
- повторно блокирует зависимость при необходимости;
- требует нового customer approval;
- создаёт durable activity `MaterialSupplyUpdated`;
- создаёт durable notification заказчику, если повторное согласование требуется после изменения исполнителем.

Изменение MaterialPick, пересчитанный dependency status и outbox intents `ACTIVITY_EVENT` / при необходимости `NOTIFICATION_EVENT` входят в **одну business transaction**. После commit API может доставить activity/notification inline через существующий `SideEffectDelivery`, но inline delivery не является единственной копией истории: тот же outbox остаётся retryable/fenced для worker. Сбой UI-аудита после commit не должен приводить к потере записи об изменении ответственности.

`purchased` и позиции в активной закупке для такой правки закрыты.

## 4. ACL и финансовая ответственность

Generic project `write=True` недостаточен для изменения supply responsibility.

`PATCH /api/v1/projects/{project_id}/material-picks/{pick_id}/supply` разрешён только:

- заказчику проекта;
- назначенному `project.contractor_id`.

Crew/team/technical-supervision участник не может менять финансовую ответственность материала даже при наличии общего project-write access.

Purchase creation дополнительно fail-closed:

- `customer_to_buy` — только customer;
- `contractor_to_buy` — только назначенный contractor;
- non-purchase sources — `Purchase` не создаётся;
- уже закрытая наличием позиция — `Purchase` не создаётся;
- `PurchaseItem.qty` равен только `qty_to_buy`.

Customer-owned / included / third-party material не порождает фиктивные `Purchase`, `Payment` или `Expense`.

## 5. API/read model

Material pick read model публикует:

- `supply_source`;
- `qty_available`;
- `qty_delivered`;
- `qty_to_buy`;
- `material_available`;
- `qty_needed` и `stage_id` для связанной readiness логики.

Создание MaterialPick принимает supply truth. Если источник не указан, default определяется типом проекта/действующей стороны; material needs из estimate получают `contractor_to_buy` для проекта с назначенным исполнителем и `customer_to_buy` для self-managed проекта.

## 6. Mobile UX / #305

Экран материалов не выводит отдельную параллельную сущность закупки и не вводит новый visual language.

Карточка использует общие `PrimaryButton`, `filterChipStyles`, `screenTypography`, `listRowStyles`, `RenovaTheme.minTouch` и показывает компактно:

```text
<название> · <статус>
<источник/ответственный>
Доступно X из Y <unit> · к покупке Z
```

Сводка и фильтры используют supply truth:

- «Нужно купить» — только `qty_to_buy > 0`;
- «Доступно» — только физически покрытые позиции;
- «Не хватает» — физически непокрытые позиции;
- CTA «Создать закупку» появляется только для согласованных позиций, которые должна покупать текущая роль;
- non-purchase source не называется «Нужно купить»;
- изменение источника/наличия явно предупреждает о повторном согласовании;
- supply mutation не ставится в offline queue: устаревшая финансовая ответственность не должна скрыто воспроизводиться после восстановления сети.

## 7. Migration/backfill

Revision `w20materialsupply01` следует за `w19paymentevidence01`.

Backfill сохраняет историческое procurement-поведение:

- проекты с назначенным исполнителем → существующие позиции `contractor_to_buy`;
- self-managed проекты → существующие позиции `customer_to_buy`;
- `qty_available = 0`.

Temporary server defaults используются только для безопасного `NOT NULL` upgrade и затем удаляются; runtime defaults принадлежат ORM.

## 8. Обязательная доказательная матрица

До merge #298 требуются exact-head green:

1. backend behavior — own / partial / mixed / reapproval / dependency readiness / responsibility + durable audit;
2. PostgreSQL — migration head + CHECK constraints + mixed own/purchased flow + отсутствие fake finance rows;
3. mobile TypeScript/typecheck и supply-domain contracts;
4. Playwright API E2E — own material rejected from Purchase, wrong buyer rejected, correct buyer purchases only remainder;
5. existing full backend, Playwright, security, technical-spec and mobile suites без регрессий.

До получения этого набора annex остаётся `PENDING EXACT-HEAD CI`; более старый green SHA не повышает его статус.
