# Контракт достоверности цены материала

**Статус:** ACTIVE CONTRACT / EXACT-HEAD CI REQUIRED BEFORE MERGE  
**Связанный issue:** #299  
**Schema head:** `w21materialprice01`  
**Назначение:** нормативный annex к `docs/RENOVA-TECHNICAL-SPECIFICATION.md` для происхождения, проверки и использования цены `MaterialPick` в закупке.

## 1. Проблема, которую контракт запрещает

Числовое поле `MaterialPick.price` само по себе не является доказательством рыночной или пользовательской цены. Исторический endpoint содержал fallback `1000.0` без поставщика. Текущий router уже направляет production route на безопасный `material_price_sync`, однако до этого контракта persisted `MaterialPick` не хранил долговременное происхождение цены.

Запрещено:

- придумывать цену при отсутствии URL или ответа поставщика;
- заменять last-known-good price при provider/parser failure;
- создавать Purchase по цене с неизвестным происхождением;
- считать response-only `price_source` достаточной доказательной историей;
- менять уже согласованную сумму без повторного customer approval.

## 2. Каноническая запись

Единственным material master остаётся `MaterialPick`. Revision `w21materialprice01` следует за `w20materialsupply01` и добавляет в ту же таблицу:

- `price_source VARCHAR(32) NOT NULL`;
- `price_verified_at TIMESTAMP NULL`;
- `price_source_url VARCHAR(512) NULL`.

Допустимые `price_source`:

| Значение | Смысл | Допустимо для новой Purchase |
|---|---|---|
| `unset` | цена не указана | нет |
| `legacy_unknown` | историческое значение без доказуемого происхождения | нет |
| `manual` | пользователь явно указал/подтвердил цену | да, если `price > 0` |
| `live_jsonld` | цена подтверждена structured JSON-LD supplier page | да |
| `live_meta` | цена подтверждена structured meta supplier page | да |
| `live_currency` | цена подтверждена currency-marked supplier page | да |

`price_verified_at` и `price_source_url` заполняются только для live verification. Manual confirmation очищает live timestamp/source URL и становится новым явным источником истины.

## 3. Migration/backfill и карантин

Исторические строки не получают ложный статус `verified`.

Backfill:

- `price <= 0` → `unset`;
- положительные исторические цены → `manual`, поскольку сам факт существования значения не доказывает внешний источник;
- известная форма старого production stub (`price = 1000` при пустом `shop_url`) → `legacy_unknown`.

`legacy_unknown` не удаляется автоматически и не переписывается догадкой. Пользователь обязан явно подтвердить/исправить цену либо получить live verification.

Это сознательно fail-closed: редкая настоящая ручная цена ровно 1000 ₽ без URL может потребовать одно повторное подтверждение, зато исторический синтетический fallback не сможет попасть в новую закупку как будто он настоящий.

## 4. Manual mutation

`PATCH /api/v1/projects/{project_id}/material-picks/{pick_id}/price`

принимает явную цену `0..10 000 000` и:

- `price > 0` → `price_source=manual`;
- `price = 0` → `price_source=unset`;
- очищает `price_verified_at` / `price_source_url`;
- создаёт durable activity через DomainOutbox;
- запрещён при активной Purchase;
- разрешён для `draft` и для восстановления `approved` legacy truth.

Если approved-позиция подтверждается **той же суммой**, approval сохраняется: меняется только provenance. Если сумма меняется, MaterialPick переводится в `pending` и требует нового customer approval.

## 5. Live verification

`POST /api/v1/projects/{project_id}/material-picks/{pick_id}/sync-price`

использует SSRF-safe supplier fetch и выполняет внешний запрос **без удержания DB row lock**. После ответа выполняется fresh row lock + compare-and-commit по URL, цене, shop и status.

Live price записывается только если parser вернул `verified_live=true` (`live_jsonld|live_meta|live_currency`). Тогда в одной business transaction фиксируются:

- цена;
- `price_source`;
- `price_verified_at`;
- final validated `price_source_url`;
- при необходимости supplier name;
- durable activity intent.

Если live price отличается от уже approved суммы, статус возвращается в `pending`. Если цена совпадает, approval не сбрасывается и provenance усиливается.

Provider/parser unavailable, HTTP failure, unsupported content или отсутствие доказуемой цены **не изменяют** last-known-good price/provenance.

## 6. Read truth

`GET /api/v1/projects/{project_id}/material-picks/{pick_id}/price-truth` публикует persisted provenance без нового provider call:

- `price_source`;
- `price_verified`;
- `price_verified_at`;
- `price_source_url`;
- `price_actionable`.

`price_verified=true` означает только сохранённую live verification record. `manual` является допустимой пользовательской ценой, но не называется внешне проверенной.

## 7. Purchase financial gate

`PurchaseItem.unit_price` может быть создан из MaterialPick только когда одновременно:

1. material approval/supply/responsibility gates выполнены;
2. `price > 0`;
3. `price_source ∈ {manual, live_jsonld, live_meta, live_currency}`.

`unset` и `legacy_unknown` возвращают `purchase_pick_price_unverified` и не создают Purchase/Payment/Expense truth.

Это предотвращает попадание старого synthetic value в новую финансовую цепочку даже если numeric field физически существует в БД.

## 8. Mobile UX

Карточка материала показывает отдельную семантику:

- «Цена указана вручную»;
- «Цена проверена по поставщику» + время проверки;
- «Историческая цена: происхождение не подтверждено»;
- «Цена не указана».

Для `legacy_unknown/unset` пользователь получает прямой recovery path: сохранить цену вручную или, при наличии URL, проверить по supplier page. Provider failure не показывается как успешное обновление.

Для approved legacy-позиции доступно подтверждение существующей суммы. Если пользователь меняет сумму, UI получает новый `pending` status и дальнейшая закупка требует повторного согласования.

## 9. Transaction / concurrency / audit

Price mutation и durable activity intent входят в одну DB transaction. External fetch выполняется до row lock; окончательная запись производится только после fresh locked compare.

Критические гарантии:

- stale concurrent edit → `material_pick_price_sync_stale`;
- active Purchase → mutation forbidden;
- same-value manual confirmation replay-safe по конечному состоянию;
- provider unavailable не уничтожает verified/manual provenance;
- changed approved amount не может остаться approved;
- Purchase с unknown provenance fail-closed.

## 10. Доказательная матрица до merge

Требуются exact-head green:

1. focused backend provenance tests;
2. full backend regression;
3. PostgreSQL Alembic upgrade/schema parity through `w21materialprice01`;
4. API/router contract: ровно один canonical runtime sync-price route;
5. mobile typecheck / relevant screen contracts;
6. Playwright/API regression;
7. CodeQL/security/technical-spec/readiness gates.

Repository CI доказывает только `CI VERIFIED`. Реальная актуальность supplier price в конкретный момент зависит от external page и не превращается в `PRODUCTION VERIFIED` без соответствующего runtime evidence.
