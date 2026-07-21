# W74 — интеграции без платежей (2026-07-20)

Связки scale/retention: **1С → Document Center**, **выписка → расходы**, **ФНС verify_mode**, **digest с home**, **portal share**.

## Что сделано

### 1. 1С / банк выгрузки → документы
- `_archive_and_respond` + `register_export_in_documents`: CSV/XML/CommerceML/реестр банка пишут запись в Document Center и activity.
- CommerceML: каталог **Товары** из строк сметы + документы оплаты.

### 2. Банк CSV → факт без эквайринга
- `create_expenses: true` на `POST …/import/bank-statement`.
- `expense_from_bank_row` + refresh budget facts.
- DocumentsHub: после матча предлагает создать расходы из unmatched.

### 3. ФНС
- Scan/reverify возвращают `verify_mode` (`live|demo|off`) и `live_verify_ready`.
- ReceiptList показывает режим в алерте.

### 4. Digest
- Home «Ещё»: CTA «Недельный дайджест» → push + документ (как в DocumentsHub).

### 5. Portal
- «Поделиться статусом с семьёй» — Share/clipboard (прогресс, исполнитель, действия) без оплаты.

## Тесты
`backend/tests/test_w74_integrations.py` — 4 кейса.

## Вне скоупа / ops
Kontur live, HTTPS staging, YuKassa, FNS live credentials, полный TS baseline→0, CI workflow OAuth.
