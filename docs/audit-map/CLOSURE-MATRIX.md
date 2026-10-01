# Матрица закрытия аудита

Состояние: 2026-10-01, `main` после волн 0–5 (коммиты `f6a72d86..origin/main`, 63 шт.) плюс незакоммиченные правки рабочей копии на момент проверки. Исходный аудит: [README.md](README.md) и реестры 01–14. Метод: для каждой записи P0/P1 сверены коммиты (`git log --grep`, `-S`), тесты в `backend/tests` и `apps/mobile`, текущий код по file:line; спорное подтверждалось целевыми тестами (test_money_role_acl, test_payment_lifecycle_wave1, test_contract_gate_parties, test_portal_token_scope_and_safe_env, test_journey_regression и др. — все зелёные). Полные `pytest` и `npm run mobile:test` не запускались; UI-записи проверены по коду и контрактным тестам, не в браузере. Продуктовый код этой проверкой не менялся.

Статусы: **ЗАКРЫТО** — есть коммит/тест, дефекта в текущем коде нет; **ЧАСТИЧНО** — сделана часть; **ОТКРЫТО** — не исправлено; **УСТАРЕЛО** — запись неверна. Записи P2/P3 не разбирались.

## 1. Сводка

| Срез | P0: закр./частично/откр. | P1: закр./частично/откр. | Всего P0+P1 |
|---|---|---|---|
| 01 Роли и доступ | 2 / 0 / 0 | 11 / 0 / 0 | 13 |
| 02 Этапы и приёмка | 1 / 0 / 0 | 9 / 0 / 0 | 10 |
| 03 Деньги | 2 / 0 / 0 | 11 / 3 / 1 | 17 |
| 04 Смета и закупки | 1 / 0 / 0 | 10 / 0 / 7 | 18 |
| 05 Документы и портал | 5 / 0 / 0 | 9 / 0 / 1 | 15 |
| 06 Чаты и уведомления | — | 10 / 0 / 0 | 10 |
| 07 Технадзор и комнаты | 1 / 0 / 0 | 4 / 1 / 0 | 6 |
| 08 Биржа и команды | — | 14 / 3 / 0 | 17 |
| 09 Перепись экранов | 6 / 0 / 0 | 19 / 6 / 15 | 46 |
| 10 Компоненты и офлайн | — | 11 / 0 / 0 | 11 |
| 11 Backend A | — | 6 / 1 / 0 | 7 |
| 12 Backend B | 2 / 0 / 0 | 9 / 1 / 2 | 14 |
| 13 Сквозной API-сценарий | 2 / 0 / 0 | 7 / 1 / 1 | 11 |
| 14 Живой UI-обход | 2 / 0 / 0 | 2 / 2 / 0 | 6 |
| **Итого** | **24 / 0 / 0** | **132 / 18 / 27** | **201** |

Итог: P0 — 24 из 24 закрыты. P1 — 132 закрыты, 18 частично, 27 открыты из 177. Записи в срезах дублируют друг друга (одна проблема найдена несколькими аудиторами), поэтому уникальных проблем меньше, чем строк.

Оговорки по доказательствам: закрытия ниже, помеченные «(РК)», опираются на правки рабочей копии, которые на момент проверки ещё не были закоммичены другими агентами волны; после их коммита метка снимается. Записи со статусом ЗАКРЫТО, но с непустым «ост.» — закрыты по сути, остаточный риск описан.

## 2. Матрица по срезам

### 01 Роли и доступ

| ID | Серьёзность | Кратко | Статус | Доказательство |
|---|---|---|---|---|
| ROLE-001 | P0 | customer_budget (приватный лимит) отдаётся исполнителю/гостю в ProjectOut | ЗАКРЫТО | 3063de32; projects.py:68-70 (только access_mode==owner); tests/test_money_role_acl.py::test_patch_project_allowed_for_customer_and_budget_hidden_from_others (прогнан, зелёный) |
| ROLE-005 | P0 | purge проекта каскадно удаляет подтверждённые платежи/акты без защиты | ЗАКРЫТО | 6ec54ebc: project_service._purge_blockers (платежи, подписанные документы, принятые акты) -> PurgeBlocked; tests/test_project_purge_guard.py (прогнан, зелёный) |
| ROLE-002 | P1 | Исполнитель самозахватом становится лидом проекта без согласия заказчика | ЗАКРЫТО | e585a9d1, e5f0703d; /assign создаёт заявку (project_assignment_requests); tests/test_assignment_requests.py::test_self_claim_does_not_assign_and_notifies_customer |
| ROLE-003 | P1 | Заказчик не может заменить/снять лида-исполнителя (409 already_assigned) | ЗАКРЫТО | e585a9d1: DELETE /projects/{id}/contractor (project_assignment_integrity.py:202); test_release_free_then_replace, test_release_blocked_by_started_stage_and_signed_document — ост.: Авто-освобождение при удалении аккаунта лида не добавлено, но заказчик может снять лида вручную. |
| ROLE-004 | P1 | PATCH /projects/{id} разрешён лиду/бригаде без проверки роли | ЗАКРЫТО | 3063de32; projects.py:355 require_project_owner; tests/test_money_role_acl.py::test_patch_project_forbidden_for_contractor_side |
| ROLE-006 | P1 | Каталог шлёт profile.id в /contractor, ждущий users.id: Подключить даёт 404 | ЗАКРЫТО | e585a9d1: /contractor принимает id профиля; tests/test_assignment_requests.py::test_direct_link_accepts_profile_id_and_self_claim_helper_route_is_owner_only |
| ROLE-007 | P1 | Код объекта (8 символов UUID) не принимается ни сервером, ни клиентом | ЗАКРЫТО | e585a9d1, e5f0703d: POST /projects/join-by-code/claim; ContractorClaimPanel.tsx:33 claimProjectByCode; test_join_by_code_creates_request_only_and_lists_names |
| ROLE-008 | P1 | Участники проекта пишутся, но доступа не получают (403 на проект и список) | ЗАКРЫТО | 644f0c12: режим participant в project_access_mode, scope_allows; tests/test_project_participant_access.py — ост.: Мобильного UI участников по-прежнему нет, но API-доступ работает. |
| ROLE-009 | P1 | Диплинк renova://team/join/<token> не имеет маршрута в приложении | ЗАКРЫТО | 79111cdb: apps/mobile/app/team/join/[token].tsx, онбординг принимает teamToken (role.tsx:49) |
| ROLE-010 | P1 | QR-сканер показывает «вступил» при ответе 200 ok:false, без debounce | ЗАКРЫТО | 79111cdb; (contractor)/_screens/team-qr.tsx:162-164 requireSuccessfulTeamJoin + joiningRef |
| ROLE-011 | P1 | Заказчику показывают paywall «Нужен Pro» (тариф исполнителя) | ЗАКРЫТО | 79111cdb; RenovaContext.tsx:893 canPurchasePro, ContractorDirectory.tsx CUSTOMER_PRO_LIMIT_NOTICE; lib/paywallPolicy.test.ts |
| ROLE-014 | P1 | После входа навигация по выбранной на экране роли, а не user.role сервера | ЗАКРЫТО | 79111cdb; lib/loginRole.ts resolveLoginRole + loginRole.test.ts; role.tsx:91-94 — ост.: role.tsx continueWithoutTeam (стр.135) всё ещё берёт выбранную роль, но вызывается после входа с resolved role. |
| ROLE-016 | P1 | Нет удаления аккаунта в приложении; сервер удаляет заказчика с активным проектом | ЗАКРЫТО | 6c3c13b2: account_lifecycle_service.account_deletion_blockers — 409 account_deletion_blocked при активном проекте с контрагентом или незавершённых платежах (pending/processing/paid_unverified/disputed); GET /auth/me/deletion-check; анонимизация + отзыв сессий, push-токенов и портал-ссылок; purge не трогает пользователя, на которого ссылается проект; tests/test_account_deletion_rules.py (5, зелёные) — ост.: Автопередача активных проектов не делается (пользователь сначала завершает/архивирует) — продуктовое решение. |

### 02 Этапы и приёмка

| ID | Серьёзность | Кратко | Статус | Доказательство |
|---|---|---|---|---|
| STG-001 | P0 | PATCH /stages/payment-plan доступен подрядчику/прорабу, сумма не сверяется с бюджетом | ЗАКРЫТО | 3063de32: только заказчик, сумма<=цены договора (422), review/done 409; tests/test_money_role_acl.py::test_payment_plan_* (прогнан, зелёный) |
| STG-002 | P1 | Подрядчик сам продлевает SLA доработки без согласия заказчика, без лимита | ЗАКРЫТО | e63290b3, f4685109: продление = запрос, подтверждает заказчик, лимит 14 дн.; tests/test_stage_lifecycle_wave2.py::test_contractor_extension_is_a_request_customer_confirms (зелёный) |
| STG-003 | P1 | Статус пункта графика двигает этап в обход договора/зависимостей/ролей | ЗАКРЫТО | 8e3b64db: 409 schedule_item_status_follows_stage, sync_stage_from_item_status удалён; test_schedule_revision_and_calendar_locks::test_item_status_cannot_move_stage_and_mirrors_it |
| STG-004 | P1 | submitted из графика ставит review без WorkAcceptance: тупик приёмки | ЗАКРЫТО | 8e3b64db: пункт больше не меняет этап, submit только через канонический /submit; 23bbdbbb убрал CTA в плане; тот же тест |
| STG-005 | P1 | Прораб/член бригады не видит этапы (assignee_id нигде не выставляется) | ЗАКРЫТО | e63290b3: лид/прораб видят все этапы и стартуют, PATCH /stages/{id}/assignee; test_foreman_sees_stages_and_can_start, test_plain_member_cannot_start_unassigned_stage_but_can_when_assigned |
| STG-006 | P1 | contract-gate ok, а POST /start даёт 403 contract_not_signed при отсутствии договора | ЗАКРЫТО | 185f8dd7, 1fc8130a: gate при подключённом исполнителе без договора = ok:false reason=no_contract (project_document_service.py:689), кнопка «Создать договор» (StageDetailHero.tsx:125); tests/test_contract_gate.py:78 |
| STG-007 | P1 | Подтверждённый график нельзя изменить/пересоздать, навсегда блокирует даты этапов | ЗАКРЫТО | 8e3b64db, 23bbdbbb: POST /work-schedules/{id}/revisions, архивирование старой версии, 409 на второй график; test_confirmed_schedule_revision_cycle (зелёный) |
| STG-008 | P1 | PATCH /calendar/stages меняет даты в обход ролей и подтверждённого графика | ЗАКРЫТО | 8e3b64db: идёт через stage_mutation_service.update_dates (роль, lock, границы); test_calendar_stage_dates_patch_follows_schedule_rules (зелёный) |
| STG-009 | P1 | .ics-импорт перезаписывает даты завершённых этапов, нечёткое сопоставление | ЗАКРЫТО | 8e3b64db: та же проверка роли/lock, события на done-этапы и вне окна проекта пропускаются; test_ical_import_roles_lock_and_done_stage (зелёный) — ост.: Нечёткое сопоставление по подстроке имени в целом сохранено; предпросмотра сопоставления нет (не проверял). |
| STG-010 | P1 | Зависимость нельзя снять, этап нельзя отменить: предшественник блокирует навсегда | ЗАКРЫТО | e63290b3: DELETE /dependencies/{id} (waived), PATCH depends null, DELETE /stages/{id} для не начатых; test_clearing_dependency_unblocks_start_and_sync_does_not_resurrect_it, test_delete_unstarted_stage_* — ост.: Статус cancelled/skipped не введён (удаление вместо него); начатый этап удалить нельзя (409). |

### 03 Деньги

| ID | Серьёзность | Кратко | Статус | Доказательство |
|---|---|---|---|---|
| MNY-001 | P0 | PATCH payment-plan без проверки роли и суммы | ЗАКРЫТО | 3063de32; stage_mutations.py:262 require_project_owner, Σ≤цены, 409 после review; tests/test_money_role_acl.py (прогнан, 32 passed) |
| MNY-002 | P0 | Ручной чек подрядчика 1 ₽ подтверждает счёт 5000 ₽ | ЗАКРЫТО | 02fb4503; test_payment_lifecycle_wave1.py::test_one_ruble_receipt_does_not_confirm_5000_invoice, test_contractor_cannot_attach_receipt (прогнан) |
| MNY-003 | P1 | Ручной расход подрядчика сразу confirmed в budget_spent | ОТКРЫТО | budget_service_legacy.py:185-205 MANUAL/manual_entry -> confirmed; receipts.py:329 manual_receipt write=True без роли — ост.: Не сделано: нет статуса «на согласовании» для расходов подрядчика (продуктовое решение) |
| MNY-004 | P1 | member бригады выставляет счета/допработы (нет capability billing) | ЧАСТИЧНО | 3063de32: план оплат только заказчик; payments.py:157 и change_orders.py:51 по-прежнему write=True без capability — ост.: Остались счета, допработы: роль member/foreman не ограничена; capability billing не введена |
| MNY-005 | P1 | Σ счетов этапа может превышать payment_amount | ЗАКРЫТО | 02fb4503; payment_service.py:553 stage_invoice_exceeds_stage_amount; test_sum_of_stage_invoices_cannot_exceed_stage_amount |
| MNY-006 | P1 | Нет отмены/правки счёта | ЗАКРЫТО | 02fb4503; payments.py:452 cancel, :494 PATCH; test_contractor_cancels_and_customer_rejects_pending_invoice |
| MNY-007 | P1 | После cancelled автосчёт не пересоздаётся | ЗАКРЫТО | 02fb4503; test_cancelled_invoice_frees_stage_amount_and_autoinvoice_is_recreated |
| MNY-008 | P1 | Автосчёт не выставляет остаток после частичного | ЗАКРЫТО | 02fb4503; accept_orchestrator.py:81 remainder; test_autoinvoice_covers_only_remainder_after_partial_invoice |
| MNY-009 | P1 | paid_unverified без выхода (нет очереди админа, чек нельзя прикрепить) | ЗАКРЫТО | 02fb4503, c66e36c9; test_covering_receipt_after_paid_unverified_confirms..., recipient-response payments.py:535 — ост.: Очередь ревью для админа не сделана; выход реализован иначе (чек/ответ получателя) |
| MNY-010 | P1 | В dev любой подрядчик — админ evidence-review любого проекта | ЧАСТИЧНО | 43de275c: ENVIRONMENT по умолчанию production (fail-closed); admin_access.py:35 local fallback и payment_evidence.py:253 без членства в проекте остались — ост.: Остаётся только в development/test без ADMIN_USER_IDS; членство в проекте не проверяется |
| MNY-011 | P1 | Нет «Продолжить оплату» для processing | ЗАКРЫТО | c66e36c9; PaymentDetailSheet.tsx:197 canResumeCard, :915; BudgetPaymentsSection.tsx:169 |
| MNY-014 | P1 | Оплата Оплачено, а budget_spent не растёт при непроверенном чеке | ЗАКРЫТО | 02fb4503; test_confirmed_by_unverified_receipt_reaches_fact, test_confirmed_stage_payment_is_in_budget_spent |
| MNY-015 | P1 | Подрядчик не может подтвердить/оспорить получение, спор односторонний | ЗАКРЫТО | 02fb4503, 38e1a804; payments.py:535 recipient-response; test_recipient_*; test_payment_dispute_response_and_requisites.py |
| MNY-017 | P1 | IDOR budget-room-lines без project_id | ЗАКРЫТО | a2f942fe; analytics.py:83 фильтр project_id; test_budget_room_lines_foreign_room_not_leaked (прогнан) |
| MNY-020 | P1 | Одобренная допработа не создаёт счёт | ЗАКРЫТО | ebf2fa51; change_order_service._ensure_order_payment; test_change_order_payment_link.py — ост.: В рабочей копии (не закоммичено) ещё правят связь change_order_id/stage_id; разнесение по плану этапов не проверялось (РК) |
| MNY-022 | P1 | Банковская выписка: abs() превращает приходы в расходы | ЗАКРЫТО | 02fb4503; bank_import.py:26 знак сохраняется; test_bank_statement_keeps_sign_incoming_is_not_expense |
| MNY-029 | P1 | Нет чека самозанятого, verify-me ставит npd_verified любому | ЧАСТИЧНО | x08-срез; npd_verification.py (интерфейс провайдера none/manual), fns.py verify-me, флаг NPD_OWNERSHIP_ENFORCED; test_npd_ownership_provider.py — ост.: Чека самозанятого по-прежнему нет; реального провайдера владения нет (нужна интеграция «Мой налог»/Госуслуги). Без флага npd_verified = статус ФНС (совместимость), но ответ честно отдаёт ownership_status=unverified; с флагом — verified только при доказанном владении

### 04 Смета и закупки

| ID | Серьёзность | Кратко | Статус | Доказательство |
|---|---|---|---|---|
| EST-001 | P0 | Правка комнаты после lock переписывает смету и бюджет | ЗАКРЫТО | 6ec54ebc; tests/test_room_estimate_lock.py (2 passed, прогнан) |
| EST-002 | P1 | lock при proposal_stale отвечает 200 ok без фиксации | ЗАКРЫТО | a2f942fe; estimate.py:185-190 409 proposal_expired; EstimateSummaryLayer.tsx:118; test_lock_expired_and_changed_since_proposal |
| EST-003 | P1 | Правка цены после propose не блокирует lock | ЗАКРЫТО | a2f942fe; estimate.py estimate_changed_since_proposal 409; тот же тест |
| EST-004 | P1 | LinePatch принимает отрицательные/нулевые значения | ЗАКРЫТО | a2f942fe; estimate.py:33-38 Field(gt=0/ge=0, allow_inf_nan=False); test_patch_validation_notes_and_fact_after_lock |
| EST-005 | P1 | notes не сохраняется в LinePatch | ЗАКРЫТО | a2f942fe; estimate.py:38 notes; тот же тест |
| EST-006 | P1 | quantity_actual нельзя править после lock | ЗАКРЫТО | a2f942fe; тест: после lock PATCH quantity_actual 200, unit_price 409 |
| EST-007 | P1 | Три несовместимых факта материалов | ЗАКРЫТО | a2f942fe; analytics.py:103-107 единое определение; test_materials_fact_single_definition; CALCULATION-REGISTRY.md |
| EST-008 | P1 | parseFloat режет «12,5», нельзя ввести 0 | ЗАКРЫТО | c221fa82; lib/parseLocaleNumber.ts; EstimateLineEditorCard.tsx:78, MaterialPickList.tsx:109, OsSelectionsScreen.tsx:102; parseLocaleNumberWired.test.ts |
| EST-009 | P1 | calc-materials падает AttributeError floor_sq_m | ЗАКРЫТО | a2f942fe; os.py:289 room_dimensions_incomplete; test_calc_materials_typical_room_and_incomplete_dimensions |
| EST-010 | P1 | Нельзя отменить закупку до delivered (UI) | ОТКРЫТО | purchaseLifecycle.ts:19-21 purchaseCancelStatus только delivered; PurchaseList.tsx:35 — ост.: Не сделано: кнопка отмены для draft/ordered/paid и возврат |
| EST-011 | P1 | OsMaterialsScreen: любой сбой = «Проверьте сеть», готовые позиции без фильтра цены | ОТКРЫТО | OsMaterialsScreen.tsx:155,175,207 тексты без detail.message; procurementNextAction.ts:35-47 без price_actionable — ост.: Не сделано |
| EST-012 | P1 | Любой участник ставит закупке paid/delivered, растёт budget_spent | ЗАКРЫТО | 3063de32; purchases.py роль+PURCHASE_TRANSITION_ROLES; test_money_role_acl.py::test_purchase_* |
| EST-013 | P1 | Подбор создаёт MaterialPick qty=1 шт, источник contractor_to_buy | ОТКРЫТО | selection_service.py:19-20 qty=1, unit=шт; supply_source не задаётся — ост.: Не сделано: у SelectionItem нет количества (нужна миграция/продуктовое решение) |
| EST-015 | P1 | Вывоз мусора: draft->requested только исполнителю, нет отмены draft/scheduled | ОТКРЫТО | waste_order_service.py:15-24,50-57 без изменений — ост.: Не сделано |
| EST-016 | P1 | Вывоз: цена 4500 x 8 м3 = 36000, Expense не создаётся | ОТКРЫТО | WasteOrderList.tsx:68,101 без изменений; analytics.py:112 volume*price — ост.: Не сделано: семантика price и Expense при done |
| EST-021 | P1 | IDOR версий шаблонов чек-листов | ЗАКРЫТО | a2f942fe; checklist_templates.py, project_checklists.py; test_checklist_template_versions_acl |
| EST-025 | P1 | Нет PATCH/DELETE MaterialPick, отзыв согласования | ОТКРЫТО | grep: в materials.py только PATCH supply/price; require_editable_pick не вызывается — ост.: Не сделано |
| EST-026 | P1 | Ручной материал без количества/ед., нет формы у заказчика | ОТКРЫТО | MaterialPickList.tsx:337-338 qty:1, unit:'шт' — ост.: Не сделано |

### 05 Документы и портал

| ID | Серьёзность | Кратко | Статус | Доказательство |
|---|---|---|---|---|
| DOC-001 | P0 | Портал-JWT давал полный доступ пользователя (write-эндпоинты) | ЗАКРЫТО | 0ca98c7b: deps.py enforce_portal_token_scope (только snapshot/yookassa-checkout, проект и scope); tests/test_portal_token_scope_and_safe_env.py (прогнан, зелёный) |
| DOC-002 | P0 | Исполнитель выпускает портал-ссылку заказчика с правами подписи/оплаты | ЗАКРЫТО | 0ca98c7b: portal.py create_customer_portal_link 403 portal_write_scopes_customer_only; test_contractor_cannot_issue_write_scope_link_for_customer |
| DOC-003 | P0 | Гейт договора засчитывает подпись любой одной стороны | ЗАКРЫТО | 185f8dd7: project_contract_gate требует required_parties (customer+contractor); tests/test_contract_gate_parties.py::test_one_party_does_not_open_gate_two_do (прогнан) |
| DOC-004 | P0 | Клиент сам создаёт contract-документ и снимает гейт | ЗАКРЫТО | 185f8dd7: documents.py _reject_system_document_type (POST и upload), SYSTEM_ONLY_DOCUMENT_TYPES; test_post_and_upload_contract_type_rejected_and_do_not_open_gate |
| DOC-005 | P0 | Подмена версии подписанного договора, гейт не сверяет версию | ЗАКРЫТО | 185f8dd7: add_version -> signed_document_version_locked; signed_parties только по current_version_id; _main_contracts без archived/deleted; test_new_version_after_signature_blocked |
| DOC-006 | P1 | Договор доп. работ без содержимого нельзя подписать | ЗАКРЫТО | 185f8dd7: CO-документ kind=addendum с href; tests/test_co_draft_document.py (подпись допработ 200, вне гейта) |
| DOC-007 | P1 | Допработа до фиксации сметы блокирует создание основного договора | ЗАКРЫТО | 185f8dd7: _main_contracts фильтрует change_order_id IS NULL, ensure_contract_draft по нему; test_change_order_document_does_not_block_or_open_gate |
| DOC-008 | P1 | Удаление договора ломает гейт и старт этапа (рассинхрон) | ЗАКРЫТО | 185f8dd7/1fc8130a: soft_delete/archive -> main_contract_protected; единый project_contract_gate; кнопка Создать договор (DocumentsHub, StageDetailHero); test_main_contract_cannot_be_deleted_or_archived |
| DOC-009 | P1 | Договор рисуется на лету, подпись без content_hash | ЗАКРЫТО | eb182812: снимок+hash при подписи (_freeze_contract_snapshot), миграция x03contractsnap01; tests/test_contract_snapshot.py |
| DOC-010 | P1 | Список Нужно подписать строится по draft, а не по подписям | ЗАКРЫТО | 185f8dd7 + lib/domain/documentSigning.ts awaitsMySignature: «Нужно подписать» в DocumentsHub и портале считается по подписям пользователя (подписал первым исполнитель — заказчик всё равно видит документ, свою подписанную — нет); documentSigning.test.ts (tsx, зелёный) |
| DOC-011 | P1 | Локальное хранилище: upload-url null, файл не сохраняется | ЗАКРЫТО | 8ed4174f: media.py локальный PUT с токеном; tests/test_media_local_upload.py (прогнан) |
| DOC-012 | P1 | Presign на внутренний minio:9000 недоступен снаружи compose | ЗАКРЫТО | 8ed4174f: storage_service presign от S3_PUBLIC_URL; test_presign_uses_public_endpoint |
| DOC-013 | P1 | purge проекта удаляет подписанные документы | ЗАКРЫТО | 6ec54ebc: project_service.py:~536-559 legal-hold по DocumentSignature блокирует purge (legal_hold_blocks_purge) — ост.: удаление байтов в хранилище и уведомление контрагента не добавлены, но подписанные проекты теперь не purge |
| DOC-014 | P1 | Внешняя подпись зависает в submitting/pending, отмены нет | ОТКРЫТО | outbox_dead_letter_service.py без ссылок на подпись; в project_document_service нет таймаута/ручки отмены (failed только через webhook :733) — ост.: не сделано: таймаут/expired, dead-letter->failed, ручка отмены |
| DOC-015 | P1 | Портал: заказчик подписывает документ без просмотра | ЗАКРЫТО | cfccd1ae: GET /portal/projects/{id}/documents/{doc}/content (scope read, portal-JWT, только проект ссылки), кнопка «Открыть» в PortalScreen перед подписью; tests/test_portal_document_content.py (зелёный) |

### 06 Чаты и уведомления

| ID | Серьёзность | Кратко | Статус | Доказательство |
|---|---|---|---|---|
| COM-001 | P1 | Уведомления пишутся, но ни один экран их не показывает | ЗАКРЫТО | 1a538c2d: notification-center.tsx, колокольчик в OsTabsLayoutOptions, notificationsFeed.test.ts; 3a4eedb3 test_notifications_inapp_read.py |
| COM-002 | P1 | Тап по push открывает customer-вкладки для подрядчика | ЗАКРЫТО | 9df63074 notification_links.link_for_role + test_notification_delivery_reliability; b406233f notificationNavigation.ts(.test) роль из payload/сессии |
| COM-003 | P1 | Фото чата не рисуются: запрос медиа без Authorization | ЗАКРЫТО | 22ca2f23: chat/ChatImage.tsx (авторизованная загрузка), ChatThreadView.tsx:226; test_chat_pagination_search_attachments::test_png_attachment_works_and_media_acl_still_requires_auth |
| COM-004 | P1 | Не-изображение в чате даёт HTTP 500 | ЗАКРЫТО | 22ca2f23: chats.py:96-98 unsupported_image_type->415, 413 для больших; picker mediaTypes ['images'] (ChatThreadView.tsx:973); test_unsupported_attachment_is_client_error_not_500 — ост.: PDF/документы по-прежнему не поддерживаются, но отказ штатный |
| COM-005 | P1 | Члены команды/гости/технадзор не получают чат-уведомления и инбокс | ЗАКРЫТО | 52192a72: notification_recipients.py, chat_inbox.py по роли в проекте; tests/test_notification_recipients.py::test_inbox_set_covers_team_guest_supervisor_and_skips_trash (прогнан) |
| COM-006 | P1 | Нет revoke участника, edit/delete сообщения, удаления/переименования треда | ЗАКРЫТО | b8808a83: chats.py + ws revoke; tests/test_chat_com_hardening.py (remove_participant, edit/soft-delete, rename, leave; прогнан, 47 passed) |
| COM-007 | P1 | Инбокс чатов не фильтрует проекты в корзине (вечный бейдж) | ЗАКРЫТО | 52192a72: chat_inbox.py:42 Project.trashed_at.is_(None); test_inbox_set_covers_..._skips_trash |
| COM-008 | P1 | GET budget_alerts падает AttributeError(User.email) и шлёт push повторно | ЗАКРЫТО | analytics.py:57-70: вызов email убран, дедуп BudgetAlertSent до notify (APIA-001) — ост.: запись в GET остаётся, но дубль/500 устранены |
| COM-010 | P1 | Подтверждение confirm: автор подтверждает сам, без уведомления | ЗАКРЫТО | b8808a83: test_confirm_records_actor_notifies_author_and_refuses_self (прогнан) |
| COM-017 | P1 | Push-токен не отвязывается при logout/удалении аккаунта | ЗАКРЫТО | 9df63074/b406233f: push.py POST /unregister и DELETE /token, account_purge_service.py:30 удаляет PushToken, pushTokenLifecycle.ts(.test); test_push_unregister_is_idempotent |

### 07 Технадзор и комнаты

| ID | Серьёзность | Кратко | Статус | Доказательство |
|---|---|---|---|---|
| QLT-001 | P0 | Правка комнаты/заявка меняет зафиксированную смету и бюджет | ЗАКРЫТО | 6ec54ebc: room_service/room_mutation_service/room_requests замораживают линии и бюджет при estimate_locked_at; tests/test_room_estimate_lock.py (прогнан) |
| QLT-002 | P1 | Открытые замечания не блокируют приёмку этапа и closeout | ЗАКРЫТО | e1aeeab4: accept_orchestrator, export.py closeout; test_quality_closeout_lifecycle::test_gate_blocks_critical_high..., test_stage_acceptance_blocked_by_open_critical_and_closeout_too (прогнан) |
| QLT-003 | P1 | Самоуправляемый проект: замечание нельзя закрыть | ЗАКРЫТО | e1aeeab4: issue_service.py:320-332 SELF_MANAGED_CUSTOMER_EXTRA; issueLifecycle.ts:43; test_self_managed_customer_closes_issue_directly |
| QLT-004 | P1 | Гарантия: исполнитель не может ответить, нет reopen/уведомления, close не идемпотентен | ЗАКРЫТО | e1aeeab4: warranty_claim_service respond/close/reopen + notify; issueLifecycle.warrantyActions; test_warranty_response_reopen_close_and_notifications |
| QLT-006 | P1 | Гарантийное обращение создаётся без описания дефекта | ЗАКРЫТО | e1aeeab4: WarrantyTextModal.tsx (тема+описание), warrantyForm.ts(.test), подключён в DocumentsHub.tsx:893 — ост.: фото и комната в форме не добавлены |
| QLT-007 | P1 | Нет создания замечания вне плана, план грузит только исполнитель, нет заявки на комнату | ЧАСТИЧНО | 21f15488 add-room заявка (test_room_add_request.py), c6f1941a UI; FloorPlanPanel.tsx:183,442 и QualityControlScreen.tsx без создания — ост.: не сделано: кнопка Добавить замечание в QC (описание/комната/этап/фото) и загрузка плана заказчиком в UI |

### 08 Биржа и команды

| ID | Серьёзность | Кратко | Статус | Доказательство |
|---|---|---|---|---|
| MKT-001 | P1 | auto-assign переназначает и утекает цена прежнего победителя | ЗАКРЫТО | a98d081f; marketplace.py:765-770 (409 при назначении/не open); test_marketplace_core::test_auto_assign_refuses_reassign_and_unmatched |
| MKT-002 | P1 | Победитель может поменять цену отклика после accept | ЗАКРЫТО | a98d081f; marketplace.py:396-399 quote_locked_after_accept; test_quote_locked_after_accept_and_note_saved |
| MKT-003 | P1 | Сохранение реквизитов затирает specialties/city/bio | ЧАСТИЧНО | a98d081f 67892490; marketplace.py:309-313 exclude_unset; test_profile_requisites_save_keeps_specialties_city_bio, test_profile_null_and_oversize_do_not_wipe_or_500 (бэкенд: null не стирает, длины ограничены) — ост.: В UI профиля исполнителя по-прежнему нет полей специализаций/города/био/visible (нет в ContractorProfileScreen) — не сделано |
| MKT-004 | P1 | auto-assign назначает произвольного исполнителя без совпадения/согласия | ЗАКРЫТО | a98d081f; marketplace.py:773-810 только из откликнувшихся или score>0; test_auto_assign_picks_quoter_with_own_price_else_matching_profile |
| MKT-005 | P1 | Нет отзыва отклика/отказа/отмены/закрытия заявки | ЗАКРЫТО | a98d081f f42fd630; marketplace.py:429 withdraw, :452 close, :484 decline-assignment, :511 PATCH; test_marketplace_core |
| MKT-006 | P1 | Нет уведомлений по заявкам/откликам | ЗАКРЫТО | 4895712c; marketplace.py:425,474,561 marketplace_notifications; test_lifecycle_notifications_hide_winner_price_from_losers |
| MKT-007 | P1 | Конверсия заявки теряет цену КП/описание, выдумывает комнату | ЗАКРЫТО | 4895712c; marketplace_conversion_service.py convert_lead; test_conversion_carries_lead_and_quote_data_without_invented_room |
| MKT-008 | P1 | Конверсия обходит лимит бесплатного тарифа исполнителя | ЗАКРЫТО | 4895712c; test_conversion_respects_free_tier_limit_with_neutral_customer_message |
| MKT-009 | P1 | Каталог исполнителей линкует по profile.id (404); подбор хардкод | ЧАСТИЧНО | 4895712c/a98d081f; ContractorDirectory.tsx:32 user_id\|\|id, API отдаёт user_id — ост.: ContractorDirectory.tsx:62 по-прежнему matchContractors(userId,'capital','tiling') — параметры не из проекта |
| MKT-010 | P1 | Чат заявки: тупик для исполнителя, запись в пустоту | ЗАКРЫТО | 4895712c; marketplace.py:158-205 треды по откликнувшимся, 409 lead_thread_closed; test_pre_assignment_chat_is_closed_without_writing_into_void |
| MKT-011 | P1 | Участник проекта не получает доступа (фича мёртвая) | ЗАКРЫТО | 644f0c12; team_service.py:543-547 mode participant; test_project_participant_access.py (scope, removed loses access) |
| MKT-012 | P1 | Бригада: нет удаления/выхода/отзыва инвайтов, доступ ко всем проектам | ЧАСТИЧНО | 644f0c12 e2fa4a2b 67892490; teams.py:282 DELETE members, :298 leave, :205 invitations; test_team_member_removal.py (GET /teams/invites, DELETE /teams/invites/{id}) — ост.: Отзыв инвайтов владельцем на бэкенде есть, UI нет; членство по-прежнему даёт доступ ко всем объектам владельца (team_service.py:533-541), viewer лишь read-only — продуктовое решение |
| MKT-013 | P1 | Ложный успех приглашения/вступления в бригаду (200 ok:false) | ЗАКРЫТО | 83962b38 e2fa4a2b 79111cdb; test_team_invitations.py::test_invalid_phone_and_role_are_422_not_200 |
| MKT-014 | P1 | Телефон исполнителя в каталоге; удалённые в выдаче | ЗАКРЫТО | a98d081f; marketplace.py:153-156 _public_name, :236,:582,:785 deleted_at IS NULL; test_directory_exposes_user_id_hides_phone_and_deleted |
| MKT-015 | P1 | Любой исполнитель закрепляет за собой любой проект через /assign | ЗАКРЫТО | e585a9d1; project_assignment_integrity.py:123-145 создаёт заявку (202), не назначает; test_assignment_requests.py |
| MKT-016 | P1 | Дефолт ENVIRONMENT=development делает исполнителей админами | ЗАКРЫТО | 43de275c; config.py:15 environment='production'; test_admin_rbac_integrity::test_working_environment_is_fail_closed_without_admin_ids — ост.: В явном development остаётся local_contractor_fallback (осознанно, без отдельного флага) |
| MKT-017 | P1 | IDOR: версии чужого шаблона чек-листа | ЗАКРЫТО | checklist_templates.py:29-36 фильтр по user_id, чужой -> 404 (APIA-003) |

### 09 Перепись экранов

| ID | Серьёзность | Кратко | Статус | Доказательство |
|---|---|---|---|---|
| BUD-40 | P0 | Исполнитель выпускает портал-токен с правами заказчика (приёмка/подпись/оплата) | ЗАКРЫТО | 0ca98c7b: portal.py:136-160 для исполнителя только read (403 portal_write_scopes_customer_only); PortalSharePanel без прав по умолчанию; tests/test_portal_token_scope_and_safe_env.py (passed) |
| INB-01 | P0 | Исполнитель выпускает портал заказчику со скоупами accept/sign/pay | ЗАКРЫТО | 0ca98c7b: portal.py:136-160 write-scopes только заказчик, DocumentsHub.tsx:323 только просмотр; tests/test_portal_token_scope_and_safe_env.py |
| INB-02 | P0 | portal-JWT — полноценный access-токен, claim portal не проверяется | ЗАКРЫТО | 0ca98c7b: deps.py:62-96 enforce_portal_token_scope (проект+действия), test_portal_token_scope_and_safe_env.py + test_portal_change_order_scope.py (passed) |
| INB-03 | P0 | Договор считается подписанным по одной подписи любой стороны | ЗАКРЫТО | 185f8dd7 + eb182812: project_contract_gate (project_document_service.py:669) требует обе стороны, снимок при подписи; tests/test_contract_gate_parties.py (passed) |
| OBJ-03 | P0 | PATCH /projects/{id} доступен любому участнику с записью (vat_rate, бюджет) | ЗАКРЫТО | 3063de32: только заказчик-владелец; tests/test_money_role_acl.py (15 passed) |
| REP-09 | P0 | POST purchases/{id}/status: любой с записью ставит paid и меняет факт бюджета | ЗАКРЫТО | 3063de32: карта статус→роль, PermissionError→403; tests/test_money_role_acl.py::test_purchase_* (passed) |
| BUD-01 | P1 | Исполнитель не может подтвердить/оспорить получение денег | ЗАКРЫТО | 02fb4503 recipient-response (payments.py:535), c66e36c9 «Деньги получены/не получены», 38e1a804 ответ на спор |
| BUD-02 | P1 | Подтверждение evidence только админом, счёт навсегда paid_unverified | ЗАКРЫТО | 02fb4503: выход без админа — позднее вложение чека автоподтверждает, исполнитель отвечает recipient-response; c66e36c9 UI — ост.: review по-прежнему admin-only, но не единственный выход |
| BUD-03 | P1 | budget-planner PATCH budget_planned игнорируется, UI пишет «План обновлён» | ОТКРЫТО | budget-planner.tsx:50; schemas/project.py:37-46 ProjectUpdate без budget_planned; project_profile_service PROFILE_FIELDS — ост.: См. SCR-003: решение — убрать кнопку или реализовать |
| BUD-04 | P1 | Импорт выписки (CSV от заказчика) подтверждает оплату без проверки банка | ОТКРЫТО | bank_statement_integrity.py:285-330 confirm_matches pending/processing/paid_unverified→confirmed по CSV заказчика — ост.: Продуктовое решение: источник доверия к выписке |
| BUD-19 | P1 | Любой чек с payment_id подтверждает оплату | ЧАСТИЧНО | 02fb4503: payment_service.py:425-446 чек должен покрывать сумму, прикладывать может только плательщик-заказчик, отклонённые не считаются — ост.: saved_unverified чек (без ФНС) всё ещё подтверждает; проверка полей t,s,fn в scan-receipt не усилена |
| BUD-25 | P1 | Отклонение графика с зашитой причиной, у исполнителя нет способа править план | ЧАСТИЧНО | 23bbdbbb: requestWorkScheduleRevision в lib/api/workSchedule.ts:184 + ScheduleRevisionPanel — ост.: UnifiedScheduleView.tsx:514-519 причина 'Нужна правка сроков' зашита, ссылки в чат нет |
| BUD-31 | P1 | Кнопка «Подтвердить» у автора confirm-сообщения, сервер не проверял ACL | ЧАСТИЧНО | b8808a83: chat_message_mutation.py:266 cannot_confirm_own_request (403) — ост.: UI ChatThreadView.tsx:906 всё ещё показывает кнопку автору (получит 403) |
| BUD-32 | P1 | compressDataUrl обрезает base64 — битые фото в чате | ЗАКРЫТО | 22ca2f23: вложения чата идут через авторизованную загрузку; compressDataUrl нигде не вызывается (grep), мёртвый код в lib/compressImage.ts:3 |
| BUD-33 | P1 | Таб чата без объектов показывает «Создайте объект», thread-only гость не видит чаты | ОТКРЫТО | app/(customer)/(tabs)/chat.tsx:12-14 !projects.length → ProjectEmptyState — ост.: Не исправлено (аналогично contractor-табу) |
| HOM-01 | P1 | После SMS-входа роль берётся с экрана, а не из ответа сервера | ЗАКРЫТО | 79111cdb: role from server; lib/loginRole.ts resolveLoginRole + loginRole.test.ts; role.tsx:91 |
| HOM-02 | P1 | Сбой после POST /projects → «Повторить» создаёт дубль объекта | ЗАКРЫТО | RenovaContext.tsx:625-690 шаги после создания обёрнуты в try/catch, confirm.tsx без патча budget_planned (рабочая копия) — ост.: Правка в рабочей копии, не закоммичена (РК) |
| HOM-03 | P1 | Действия заказчика на /job-leads недостижимы из интерфейса | ОТКРЫТО | ссылки на /job-leads только у исполнителя: HomeScreenBody.tsx:125 (role==='contractor'), ProjectEmptyState, ContractorProfileScreen — ост.: Продуктовое решение: куда вести заказчика (меню/профиль) |
| INB-04 | P1 | Портал-токен нельзя отозвать, виден в query/истории | ЗАКРЫТО | x07portallinks01 (portal_links, jti в токене), GET/DELETE /projects/{id}/portal-links, отзыв отсекает обмен токена и уже выданный portal-JWT (get_current_user), удаление аккаунта отзывает ссылки; PortalSharePanel: список и «Отозвать»; tests/test_portal_link_revocation.py (3), portalLinks.test.ts — ост.: Токены без jti (выданы до миграции) живут до exp (≤168 ч); токен остаётся в query-строке magic-link (не в fragment). |
| INB-05 | P1 | Заявка на изменение комнаты: исполнитель не видит/не решает в «Согласованиях» | ЗАКРЫТО | app/approvals.tsx canDecide по allowed_actions сервера, подзаголовок для исполнителя (рабочая копия) — ост.: Не закоммичено |
| INB-06 | P1 | Ошибки approve/reject (403/404/409) проглатываются | ЗАКРЫТО | app/approvals.tsx handleDecisionError: notifyError + load() при 404/409 (рабочая копия) — ост.: Не закоммичено |
| INB-07 | P1 | Слияние конфликтов: выбор «Сервер» стирает поле из PATCH | ЗАКРЫТО | FieldMergePicker.tsx: mergeFieldChoices, без server возвращает null; OfflineDiffViewer.tsx (рабочая копия) — ост.: Не закоммичено |
| INB-08 | P1 | ManagerDashboard: при загрузке/ошибке нет «Назад» и повтора | ЗАКРЫТО | ManagerDashboardScreen.tsx:101-128 BackHeader + LoadErrorState onRetry (рабочая копия) — ост.: Не закоммичено |
| INB-09 | P1 | articles-admin затирает category/summary/tags, ошибки не видны | ЗАКРЫТО | 02fccb43: articles-admin.tsx kept{category,read_min}, getArticleAdmin, validateArticleForm, notifyError |
| OBJ-01 | P1 | Запрос изменения комнаты шлёт payload {} → 422 room_patch_empty | ОТКРЫТО | OsRoomsScreen.tsx:582 onSubmit(message,{}); room_change_service.py:104-108 + room_service.py:88 validate_room_patch({})→room_patch_empty — ост.: Нужна форма полей или допуск message-only запроса |
| OBJ-02 | P1 | lock_estimate при proposal_stale отдавал ok:true без фиксации | ЗАКРЫТО | a2f942fe: estimate.py:199-201 → 409 proposal_expired; tests/test_estimate_materials_audit_fixes.py |
| OBJ-04 | P1 | Правка комнаты после фиксации сметы пересоздаёт строки и бюджет | ЗАКРЫТО | 6ec54ebc: room_service.sync_room_estimate_lines не пересчитывает при estimate_locked; tests/test_room_estimate_lock.py |
| OBJ-05 | P1 | У исполнителя нет слоя «Изменения», CTA и пуши ведут в пустоту | ОТКРЫТО | ContractorEstimateView.tsx не читает estimateLayer; EstimateChangesLayer только в CustomerEstimateView.tsx:155; procurementNav.ts:52 по-прежнему ведёт И на changes — ост.: Не сделано |
| OBJ-06 | P1 | Допсоглашение: демо-значения по умолчанию, ошибки не показываются | ЧАСТИЧНО | ContractorEstimateView.tsx:74-80 валидация названия/суммы добавлена (c221fa82); дефолты 'Доп. розетки'/'8500' (:38-39) остались, не-offline ошибка всё ещё throw без catch (:93) — ост.: Убрать предзаполнение и показывать ошибку API |
| OBJ-07 | P1 | Импорт CSV в смету виден заказчику/гостю (403), поле предзаполнено демо | ОТКРЫТО | EstimateDocumentsLayer.tsx:43 демо-CSV, кнопка :206 без проверки роли; бэк estimate.py:30-31 403 для не-исполнителя — ост.: Ролевая видимость и пустое поле не сделаны (причина ошибки частично через notifyError) |
| OBJ-08 | P1 | Поля строки сметы правятся при зафиксированной смете, ошибка проглатывается | ЧАСТИЧНО | a2f942fe/EstimateLineEditorCard.tsx:44-46 editable при !planLocked; estimate.py:76 факт/заметка разрешены — ост.: patchLine всё ещё бросает не-offline ошибки без catch (ContractorEstimateView.tsx:67) — unhandled rejection |
| OBJ-09 | P1 | Запятая в числах усекается (2,5→2), нельзя задать 0 | ЗАКРЫТО | c221fa82: parseLocaleNumber; EstimateLineEditorCard commitNumber с parsePositive/NonNegativeNumber |
| OBJ-16 | P1 | Изображение плана этажа и PDF дизайн-пакета без Authorization не открываются | ОТКРЫТО | FloorPlanPanel.tsx:354 Image uri без заголовков; DesignPackageList.tsx:113 Linking.openURL; media.py требует Authorization — ост.: Нужна загрузка с токеном (blob/headers) или подписанная ссылка |
| OBJ-32 | P1 | XLSX-экспорт: SpreadsheetML под именем .xlsx, НДС 20% зашит, XML без экранирования | ОТКРЫТО | backend/app/api/v1/export.py:178-200 (*0.2/*1.2, без escape, CSV без кавычек); lib/api/estimate.ts:164 'estimate.xlsx' — ост.: Не сделано |
| REP-01 | P1 | Исполнитель не может отметить чек-лист, гейт сдачи требует 100% | ОТКРЫТО | StageDetailScreen.tsx:392 showAcceptance только customer+review; toggleStageChecklist вызывается только из StageDetailAcceptanceFold; fa9bfb5d даёт лишь список условий gate — ост.: Нужен UI чек-листа для исполнителя |
| REP-02 | P1 | Заказчик в самоуправляемом проекте не может начать/сдать работу в UI | ОТКРЫТО | lib/domain/workLifecycle.ts:70-73 review/in_progress только contractor; бэк разрешает заказчика — ост.: Рассинхрон роли UI/backend не устранён |
| REP-03 | P1 | acceptStage глотает offline_queued, UI показывает «Этап принят» | ОТКРЫТО | lib/context/RenovaContext.tsx:754-756 offline_queued → /*queued*/; StageDetailScreen.tsx runAcceptStage всё равно вызывает alertStageAccepted; b9ea4db2 ставит в очередь и 5xx — ост.: Пробросить offline_queued и не показывать «принят» |
| REP-04 | P1 | Ошибка приёмки (409 photos_required и др.) только в лог | ЗАКРЫТО | fa9bfb5d: StageDetailScreen.tsx runAcceptStage → showActionConfirm 'Этап не принят' с причиной; completionGate.ts |
| REP-07 | P1 | «Закрыть» на каждом замечании, сервер допускает только fixed→closed (404) | ЗАКРЫТО | lib/domain/issueControlActions.ts customerIssueActions по статусу; e1aeeab4: os.py close → 409/403 с кодом (UI-часть в рабочей копии) — ост.: UI-часть не закоммичена (РК) |
| REP-08 | P1 | Функции заказчика «Вернуть/Открыть снова/Спор/Гарантия» недоступны | ЧАСТИЧНО | CustomerControlView/issueControlActions.ts: «Вернуть на доработку» (рабочая копия); e1aeeab4: warranty respond/reopen — ост.: Гарантийные действия заказчика и «в спор» из хаба не подтверждены; кнопки QC всё ещё ремапятся в хаб |
| REP-13 | P1 | Экран закупки при ошибке/неверном id — вечная «Загрузка…» без «назад» | ОТКРЫТО | app/purchase/[id].tsx:41 return <Загрузка…> без BackHeader; reload при ошибке ставит null — ост.: Состояния loading/error/not-found не добавлены |
| REP-25 | P1 | Ошибочно созданную закупку нельзя отменить (UI только из delivered) | ОТКРЫТО | lib/domain/purchaseLifecycle.ts:20 purchaseCancelStatus только delivered; бэк purchase_service.py:70-79 допускает cancel из draft/ordered — ост.: Кнопка отмены в UI не добавлена |
| REP-30 | P1 | Перевод строки графика в submitted ставит этап в review без приёмки | ЗАКРЫТО | 8e3b64db: статус строки следует этапу, 409 schedule_item_status_follows_stage; sync_stage_from_item_status удалён |
| SCR-001 | P1 | Alert.alert пустой на web — ошибки и подтверждения теряются | ЗАКРЫТО | 297b4dfd: lib/notify.ts + guard-тест lib/notifyGuard.test.ts; Alert.alert остался только в тестах |
| SCR-003 | P1 | «Применить к плану» шлёт budget_planned, backend игнорирует, UI пишет успех | ОТКРЫТО | apps/mobile/app/_stack/budget-planner.tsx:50 всё ещё patchProject{budget_planned}; schemas/project.py ProjectUpdate без поля — ост.: Нужно решение: реализовать поле/эндпоинт или убрать кнопку; ложный успех остаётся (дубль BUD-03) |
| SCR-007 | P1 | «Новый проект» виден исполнителю, POST /projects даёт 403 | ЗАКРЫТО | OsProjectPicker.tsx:353 условие user?.role==='customer' (правка в рабочей копии, не закоммичена) — ост.: Не закоммичено (РК) |

### 10 Компоненты и офлайн

| ID | Серьёзность | Кратко | Статус | Доказательство |
|---|---|---|---|---|
| CMP-001 | P1 | Запись в очередь недостижима: ApiError(0) не ставится в очередь | ЗАКРЫТО | b9ea4db2 a442ce94; api/queueableError.ts isQueueableWriteError + queueableError.test.ts; в api/*.ts нет `instanceof ApiError` перед enqueue |
| CMP-002 | P1 | Ротация refresh-токена не персистится в SecureStore | ЗАКРЫТО | 4e56e9ab; client.ts:512-515 onTokensRotated -> RenovaContext; api/sessionTransport.test.ts |
| CMP-003 | P1 | Нет глобальной реакции на 401/окончание сессии | ЗАКРЫТО | 4e56e9ab; client.ts:442 onSessionExpired -> RenovaContext.tsx:851-854 logout |
| CMP-004 | P1 | Кэш cachedGet не инвалидируется после мутаций (этап, проекты) | ЗАКРЫТО | 4e56e9ab; client.ts:216,670 invalidateCachesAfterMutation после каждой записи |
| CMP-005 | P1 | createProject без client_request_id; повтор создаёт дубль | ЗАКРЫТО | 4e56e9ab b03f6ba6; projects.ts:15-30 attemptKey; confirm.tsx:108 бюджет в одном create-вызове |
| CMP-006 | P1 | offline_queued комнаты показан как ошибка; дубль комнат | ЗАКРЫТО | a442ce94; CreateRoomSheet.tsx:142-147 isQueuedResult; rooms.ts:70 client_request_id в теле |
| CMP-007 | P1 | Повтор из очереди без refresh токена: 401 блокирует задания | ЗАКРЫТО | 4e56e9ab; offlineQueue.ts:460-463 при 401 refreshAccessToken и повтор |
| CMP-008 | P1 | recoverSession/старт безусловно зовут demoLogin (404 в prod) | ЗАКРЫТО | 4e56e9ab; RenovaContext.tsx:414 recoverSession без demo, :448 recoverDemo только isDemoEnabled, :516/:529 за isDemoEnabled |
| CMP-009 | P1 | Портал-гость: portal-JWT не уходит в Authorization | ЗАКРЫТО | 4e56e9ab 0ca98c7b; client.ts:534-560 registerPortalBearer/portalBearerFor, глобальный токен не подменяется |
| CMP-010 | P1 | Реквизиты исполнителя затираются при сбое загрузки профиля | ЗАКРЫТО | ContractorProfileScreen.tsx:46-75,122 profileState + buildRequisitesPatch (дифф от baseline); contractorProfileSave.test.ts — ост.: Правка есть в HEAD; в рабочей копии файл ещё правят (РК) |
| CMP-013 | P1 | Десятичная запятая/пробелы в числовых полях форм | ЗАКРЫТО | c221fa82; lib/parseLocaleNumber.ts + parseLocaleNumberWired.test.ts; parseFloat/Number в формах заменены |

### 11 Backend A

| ID | Серьёзность | Кратко | Статус | Доказательство |
|---|---|---|---|---|
| APIA-001 | P1 | budget-alerts: cu.email -> 500 и дубли уведомлений | ЗАКРЫТО | analytics.py:54-72 маркер BudgetAlertSent до notify, без email; test_estimate_materials_audit_fixes::test_budget_alerts_ok_and_notifies_once — ост.: Рассылка всё ещё внутри GET (воркер не выделен), но дубли исключены |
| APIA-002 | P1 | IDOR: строки сметы чужой комнаты через budget-room-lines | ЗАКРЫТО | a2f942fe; analytics.py:80 фильтр project_id; test_budget_room_lines_foreign_room_not_leaked |
| APIA-003 | P1 | IDOR: версии чужого шаблона чек-листа | ЗАКРЫТО | a2f942fe; checklist_templates.py:29-36 владелец -> 404; test_checklist_template_versions_acl |
| APIA-004 | P1 | lock фиксирует смету, изменённую после propose | ЗАКРЫТО | a2f942fe; estimate_service.py:~291 estimate_changed_since_proposal; test_lock_expired_and_changed_since_proposal |
| APIA-005 | P1 | lock отвечает 200 ok при proposal_stale | ЗАКРЫТО | a2f942fe; estimate.py:199-201 -> 409 proposal_expired; test_lock_expired_and_changed_since_proposal |
| APIA-006 | P1 | Нет UI удаления аккаунта (требование сторов) | ЗАКРЫТО | DeleteAccountButton.tsx в профиле заказчика и исполнителя: проверка deletion-check, список причин отказа, подтверждение с danger-кнопкой, DELETE /auth/me, локальный logout; lib/domain/accountDeletion.test.ts, deleteAccountWiring.test.ts (tsx, зелёные) — ост.: В симуляторе/браузере не прогонялось. |
| APIA-008 | P1 | verify-me/регистрация подтверждают НПД без доказательства владения ИНН | ЧАСТИЧНО | npd_verification.py; auth.py/otp_auth.py/fns.py используют npd_flag_for_inn; test_npd_ownership_provider.py — ост.: Доказательство владения ИНН по-прежнему требует внешнего провайдера (продуктовое решение); флаг NPD_OWNERSHIP_ENFORCED по умолчанию выключен

### 12 Backend B

| ID | Серьёзность | Кратко | Статус | Доказательство |
|---|---|---|---|---|
| APIB-001 | P0 | Portal-JWT = полная сессия заказчика, подрядчик выдаёт ссылку за заказчика | ЗАКРЫТО | 0ca98c7b; deps.py enforce_portal_token_scope, TTL 60 мин; test_portal_token_scope_and_safe_env.py, test_journey_regression::test_32 (проходит) — ост.: Отзыв/nonce самой magic-link не добавлены (токен-обмен повторяем в пределах TTL ссылки). |
| APIB-002 | P0 | ENVIRONMENT по умолчанию development: вход по X-User-Id без токена | ЗАКРЫТО | 43de275c: default production в config.py/environment.py; backend/conftest.py задаёт env; test_environment_guards.py (проходит) — ост.: Явный ENVIRONMENT=development с нелокальным URL/Postgres по-прежнему не блокируется. |
| APIB-003 | P1 | Конверсия лида и auto-assign обходят лимит бесплатных объектов (paywall) | ЗАКРЫТО | 4895712c: конверсия делит free_slot_exhausted с assign (402); auto-assign только назначает лид; test_marketplace_conversion_chat_notifications.py |
| APIB-004 | P1 | calc-materials падает 500: у Room нет floor_sq_m/wall_sq_m | ЗАКРЫТО | a2f942fe; os.py:283-293 считает метрики из размеров; test_estimate_materials_audit_fixes.py, test_journey_regression::test_11c |
| APIB-005 | P1 | Нет удаления участника бригады / выхода / отзыва приглашения | ЗАКРЫТО | 644f0c12: DELETE /teams/members/{id}, POST /teams/leave; e2fa4a2b: accept/decline приглашений; test_team_member_removal.py (проходит) — ост.: Отзыв сессий удалённого не проверял. |
| APIB-006 | P1 | ProjectParticipant не читается project_access_mode: участник получает 403 | ЗАКРЫТО | 644f0c12: режим participant со scope-проверкой, redact бюджета; test_project_participant_foundation/hardening/management |
| APIB-007 | P1 | Прораб/участник не видят этапов и не могут их запускать | ЗАКРЫТО | e63290b3 (STG-005/006): lead/foreman видят и стартуют этапы, PATCH /stages/{id}/assignee; test_stage_lifecycle_wave2.py (проходит) |
| APIB-008 | P1 | PATCH payment-plan: подрядчик/member выставляет любую сумму этапа | ЗАКРЫТО | 3063de32: только владелец, сумма<=цены договора (422), review/done заперты (409); test_money_role_acl.py, journey test_14b — ост.: Блокировки после подписи договора отдельно нет. |
| APIB-009 | P1 | PATCH /projects и customer_budget доступны любому writer | ЗАКРЫТО | 3063de32: PATCH только заказчик-владелец, customer_budget скрыт у остальных; test_money_role_acl.py |
| APIB-010 | P1 | Подрядчик сам проводит закупку paid/delivered и накручивает budget_spent | ЗАКРЫТО | 3063de32: PURCHASE_TRANSITION_ROLES, paid/откат только заказчик, перескоки 409 (purchase_service.py:66); test_money_role_acl.py — ост.: Цена позиции (material_price_sync) по-прежнему правится исполнителем без переутверждения, но на факт не влияет. |
| APIB-011 | P1 | paid_unverified не подтвердить: получателю нет ответа/спора, ревью только админ | ЧАСТИЧНО | 02fb4503: POST /payments/{id}/recipient-response + авто-confirm по чеку; 38e1a804: ответ исполнителя на спор; c66e36c9 (mobile); journey test_25f — ост.: Нет UI админ-ревью evidence и таймаутов/эскалации; админ-ревью остаётся только admin. |
| APIB-012 | P1 | Waste-заказ: заказчик без подрядчика не может перевести draft->requested | ОТКРЫТО | waste_order_service.py:validate_transition без изменений с аудита (git log пуст); нет is_self_managed — ост.: Не сделано: нужно продуктовое решение (заказчик как исполнитель в self-managed проекте). |
| APIB-013 | P1 | rework-sla/extend: подрядчик бесконечно продлевает свой срок | ЗАКРЫТО | e63290b3/f4685109: подрядчик только просит, продлевает/отклоняет заказчик, лимит 14 дн (rework_sla.py:64-109); test_stage_lifecycle_wave2.py |
| APIB-014 | P1 | Живая dev-БД не на голове Alembic, ревизия не проверяется в development | ОТКРЫТО | db/session.py:40-45 guard только staging/production; scripts/dev-runtime.sh без alembic upgrade; код не менялся — ост.: Состояние внешней dev-БД; guard для development и upgrade в dev-runtime не добавлены. |

### 13 Сквозной API-сценарий

| ID | Серьёзность | Кратко | Статус | Доказательство |
|---|---|---|---|---|
| JRN-001 | P0 | Любой исполнитель самоназначается на проект без исполнителя; заказчик не может снять | ЗАКРЫТО | e585a9d1/e5f0703d: заявка pending 202 + подтверждение заказчика, снятие DELETE /contractor; journey test_05-08b (56 passed) |
| JRN-002 | P0 | Гейт «нет работ без договора» снимается подписью одной стороны | ЗАКРЫТО | 185f8dd7 + eb182812: нужны обе подписи; journey test_16/17/18 (проходят) |
| JRN-003 | P1 | calc-materials падает 500 у всех ролей | ЗАКРЫТО | a2f942fe; journey test_11c, test_estimate_materials_audit_fixes.py |
| JRN-004 | P1 | change-orders/approve даёт 500 после commit из-за сбойной outbox-записи | ЗАКРЫТО | ebf2fa51: ответ строится до outbox-диспетча; journey test_27, test_change_order_payment_link.py |
| JRN-005 | P1 | Черновик документа «Доп. работы» нельзя подписать (contract_has_no_content) | ЗАКРЫТО | 185f8dd7/eb182812: addendum с содержимым подписывается обеими сторонами; journey test_28 |
| JRN-006 | P1 | budget_spent не учитывает платежи за этапы | ЗАКРЫТО | 02fb4503 (MNY-014): confirmed-платёж идёт в budget_spent, paid_unverified_total отдельно; journey test_25b/25h — ост.: paid_unverified намеренно не в факте (виден отдельно). |
| JRN-007 | P1 | Платёж confirmed по любому чеку, приложенному самим получателем | ЗАКРЫТО | 02fb4503: чек только плательщик (403 receipt_payment_customer_only), покрытие суммы; journey test_25c/25d |
| JRN-008 | P1 | Ошибочный счёт нельзя отменить; closeout требует подтвердить фиктивную оплату | ЗАКРЫТО | 02fb4503: POST /payments/{id}/cancel, отменённые не блокируют closeout; c66e36c9 (mobile); journey test_35/36 |
| JRN-009 | P1 | Приглашённый в чат читает тред, но писать не может (POST messages 403) | ОТКРЫТО | technical_supervision_chat.py:21-33 подменяет _post_message: require_chat_access(write=False) без allow_participant + capability communication; проба -> 403 — ост.: Не сделано; реакции приглашённому исправлены (b8808a83), отправка сообщений нет. |
| JRN-011 | P1 | Заказчик без исполнителя стартует этап и фиксирует смету; позже подключённый заперт | ЧАСТИЧНО | e63290b3: этап 1 больше не active с рождения; 185f8dd7: гейт по обеим подписям — ост.: estimate/lock без исполнителя всё ещё проходит (estimate_service.py:278-308), self-managed старт этапа разрешён; ловушка позднего исполнителя не снята. |
| JRN-024 | P1 | trash сбрасывает is_archived; purge стирает подписанное/платежи без удержания | ЗАКРЫТО | 6ec54ebc: trash сохраняет is_archived, purge блокируют financial_history_blocks_purge/legal_hold (project_service.py:495,524,642); journey test_40 — ост.: Уведомления контрагентам о purge нет (purge заблокирован при деньгах/подписях). |

### 14 Живой UI-обход

| ID | Серьёзность | Кратко | Статус | Доказательство |
|---|---|---|---|---|
| UI-002 | P0 | Профиль: админ/шаблоны/подписка -> Maximum update depth, белый экран | ЗАКРЫТО | d78961a5: статические route-файлы + AdminGate; profileFabNavTargets.contract.test ok (запущен) — ост.: В браузере/симуляторе не воспроизводил. |
| UI-003 | P0 | FAB «+» -> «В черновик»: Maximum update depth, белый экран | ЗАКРЫТО | d78961a5: app/scratchpad.tsx статический маршрут; profileFabNavTargets.contract.test ok — ост.: В рантайме не проверял. |
| UI-001 | P1 | Фиктивные «Экономия/-100 %/маржа/прогноз» при факте 0 (бюджет, портфель) | ЧАСТИЧНО | b03f6ba6: buildBudgetSummaryView/BudgetSummarySection не показывают экономию и прогноз без факта; buildBudgetSummaryView.test ok — ост.: Портфель: portfolioProjects.ts:40-45 даёт status under/«Экономия» при нулевом факте; BudgetBreakdown.tsx:43 показывает прогноз без проверки факта. |
| UI-007 | P1 | Менеджер-сводка: «+18407733 ₽» без разделителей, сырая категория «other» | ЧАСТИЧНО | b03f6ba6: formatRiskImpact, прогноз скрыт без факта; formatRiskImpact.test — ост.: Сырая категория в «Подбор: … \| other» (backend client_write_side_effects.py body=row.category) не локализована. |
| UI-010 | P1 | /work-acceptance у исполнителя редиректит в кабинет заказчика с кнопками «Принять» | ЗАКРЫТО | fa9bfb5d: роль из сессии, без редиректа до загрузки (work-acceptance.tsx); acceptanceActions.test ok |
| UI-027 | P1 | Админские пункты профиля видны обычным заказчику/исполнителю | ЗАКРЫТО | d78961a5: useAdminAccess (probe /admin/stats), AdminHubLink и «Журнал аудита» только при granted; contract test ok — ост.: «Экспорт данных» — выгрузка собственных данных (exportMyData), не админ-функция; эта часть записи устарела. |

## 3. Остающиеся открытыми и частичные P1 (P0 открытых нет)

### Требует продуктового решения

- **APIA-008** (ЧАСТИЧНО) — verify-me/регистрация подтверждают НПД без доказательства владения ИНН. Нужна внешняя проверка (Госуслуги/Мой налог OAuth) — продуктовое решение
- **APIB-012** (ОТКРЫТО) — Waste-заказ: заказчик без подрядчика не может перевести draft->requested. Не сделано: нужно продуктовое решение (заказчик как исполнитель в self-managed проекте).
- **BUD-03** (ОТКРЫТО) — budget-planner PATCH budget_planned игнорируется, UI пишет «План обновлён». См. SCR-003: решение — убрать кнопку или реализовать
- **BUD-04** (ОТКРЫТО) — Импорт выписки (CSV от заказчика) подтверждает оплату без проверки банка. Продуктовое решение: источник доверия к выписке
- **EST-013** (ОТКРЫТО) — Подбор создаёт MaterialPick qty=1 шт, источник contractor_to_buy. Не сделано: у SelectionItem нет количества (нужна миграция/продуктовое решение)
- **HOM-03** (ОТКРЫТО) — Действия заказчика на /job-leads недостижимы из интерфейса. Продуктовое решение: куда вести заказчика (меню/профиль)
- **MKT-012** (ЧАСТИЧНО) — Бригада: нет удаления/выхода/отзыва инвайтов, доступ ко всем проектам. Отзыв инвайтов владельцем на бэкенде есть (GET/DELETE /teams/invites), UI нет; членство по-прежнему даёт доступ ко всем объектам владельца (team_service.py:533-541), viewer лишь read-only — продуктовое решение
- **MNY-003** (ОТКРЫТО) — Ручной расход подрядчика сразу confirmed в budget_spent. Не сделано: нет статуса «на согласовании» для расходов подрядчика (продуктовое решение)
- **MNY-029** (ЧАСТИЧНО) — Нет чека самозанятого, verify-me ставит npd_verified любому. Не сделано; внешняя интеграция (Мой налог) / продуктовое решение «вне продукта»
- **SCR-003** (ОТКРЫТО) — «Применить к плану» шлёт budget_planned, backend игнорирует, UI пишет успех. Нужно решение: реализовать поле/эндпоинт или убрать кнопку; ложный успех остаётся (дубль BUD-03)

### Требует миграции или внешней системы

- **APIB-014** (ОТКРЫТО) — Живая dev-БД не на голове Alembic, ревизия не проверяется в development. Состояние внешней dev-БД; guard для development и upgrade в dev-runtime не добавлены.
- **DOC-014** (ОТКРЫТО) — Внешняя подпись зависает в submitting/pending, отмены нет. не сделано: таймаут/expired, dead-letter->failed, ручка отмены

### Не сделано (чистая доработка кода/UI)

- **APIB-011** (ЧАСТИЧНО) — paid_unverified не подтвердить: получателю нет ответа/спора, ревью только админ. Нет UI админ-ревью evidence и таймаутов/эскалации; админ-ревью остаётся только admin.
- **BUD-19** (ЧАСТИЧНО) — Любой чек с payment_id подтверждает оплату. saved_unverified чек (без ФНС) всё ещё подтверждает; проверка полей t,s,fn в scan-receipt не усилена
- **BUD-25** (ЧАСТИЧНО) — Отклонение графика с зашитой причиной, у исполнителя нет способа править план. UnifiedScheduleView.tsx:514-519 причина 'Нужна правка сроков' зашита, ссылки в чат нет
- **BUD-31** (ЧАСТИЧНО) — Кнопка «Подтвердить» у автора confirm-сообщения, сервер не проверял ACL. UI ChatThreadView.tsx:906 всё ещё показывает кнопку автору (получит 403)
- **BUD-33** (ОТКРЫТО) — Таб чата без объектов показывает «Создайте объект», thread-only гость не видит чаты. Не исправлено (аналогично contractor-табу)
- **EST-010** (ОТКРЫТО) — Нельзя отменить закупку до delivered (UI). Не сделано: кнопка отмены для draft/ordered/paid и возврат
- **EST-011** (ОТКРЫТО) — OsMaterialsScreen: любой сбой = «Проверьте сеть», готовые позиции без фильтра цены. Не сделано
- **EST-015** (ОТКРЫТО) — Вывоз мусора: draft->requested только исполнителю, нет отмены draft/scheduled. Не сделано
- **EST-016** (ОТКРЫТО) — Вывоз: цена 4500 x 8 м3 = 36000, Expense не создаётся. Не сделано: семантика price и Expense при done
- **EST-025** (ОТКРЫТО) — Нет PATCH/DELETE MaterialPick, отзыв согласования. Не сделано
- **EST-026** (ОТКРЫТО) — Ручной материал без количества/ед., нет формы у заказчика. Не сделано
- **JRN-009** (ОТКРЫТО) — Приглашённый в чат читает тред, но писать не может (POST messages 403). Не сделано; реакции приглашённому исправлены (b8808a83), отправка сообщений нет.
- **JRN-011** (ЧАСТИЧНО) — Заказчик без исполнителя стартует этап и фиксирует смету; позже подключённый заперт. estimate/lock без исполнителя всё ещё проходит (estimate_service.py:278-308), self-managed старт этапа разрешён; ловушка позднего исполнителя не снята.
- **MKT-003** (ЧАСТИЧНО) — Сохранение реквизитов затирает specialties/city/bio. В UI профиля исполнителя по-прежнему нет полей специализаций/города/био/visible (нет в ContractorProfileScreen) — не сделано; бэкенд защищён (null не стирает, длины ограничены)
- **MKT-009** (ЧАСТИЧНО) — Каталог исполнителей линкует по profile.id (404); подбор хардкод. ContractorDirectory.tsx:62 по-прежнему matchContractors(userId,'capital','tiling') — параметры не из проекта
- **MNY-004** (ЧАСТИЧНО) — member бригады выставляет счета/допработы (нет capability billing). Остались счета, допработы: роль member/foreman не ограничена; capability billing не введена
- **MNY-010** (ЧАСТИЧНО) — В dev любой подрядчик — админ evidence-review любого проекта. Остаётся только в development/test без ADMIN_USER_IDS; членство в проекте не проверяется
- **OBJ-01** (ОТКРЫТО) — Запрос изменения комнаты шлёт payload {} → 422 room_patch_empty. Нужна форма полей или допуск message-only запроса
- **OBJ-05** (ОТКРЫТО) — У исполнителя нет слоя «Изменения», CTA и пуши ведут в пустоту. Не сделано
- **OBJ-06** (ЧАСТИЧНО) — Допсоглашение: демо-значения по умолчанию, ошибки не показываются. Убрать предзаполнение и показывать ошибку API
- **OBJ-07** (ОТКРЫТО) — Импорт CSV в смету виден заказчику/гостю (403), поле предзаполнено демо. Ролевая видимость и пустое поле не сделаны (причина ошибки частично через notifyError)
- **OBJ-08** (ЧАСТИЧНО) — Поля строки сметы правятся при зафиксированной смете, ошибка проглатывается. patchLine всё ещё бросает не-offline ошибки без catch (ContractorEstimateView.tsx:67) — unhandled rejection
- **OBJ-16** (ОТКРЫТО) — Изображение плана этажа и PDF дизайн-пакета без Authorization не открываются. Нужна загрузка с токеном (blob/headers) или подписанная ссылка
- **OBJ-32** (ОТКРЫТО) — XLSX-экспорт: SpreadsheetML под именем .xlsx, НДС 20% зашит, XML без экранирования. Не сделано
- **QLT-007** (ЧАСТИЧНО) — Нет создания замечания вне плана, план грузит только исполнитель, нет заявки на комнату. не сделано: кнопка Добавить замечание в QC (описание/комната/этап/фото) и загрузка плана заказчиком в UI
- **REP-01** (ОТКРЫТО) — Исполнитель не может отметить чек-лист, гейт сдачи требует 100%. Нужен UI чек-листа для исполнителя
- **REP-02** (ОТКРЫТО) — Заказчик в самоуправляемом проекте не может начать/сдать работу в UI. Рассинхрон роли UI/backend не устранён
- **REP-03** (ОТКРЫТО) — acceptStage глотает offline_queued, UI показывает «Этап принят». Пробросить offline_queued и не показывать «принят»
- **REP-08** (ЧАСТИЧНО) — Функции заказчика «Вернуть/Открыть снова/Спор/Гарантия» недоступны. Гарантийные действия заказчика и «в спор» из хаба не подтверждены; кнопки QC всё ещё ремапятся в хаб
- **REP-13** (ОТКРЫТО) — Экран закупки при ошибке/неверном id — вечная «Загрузка…» без «назад». Состояния loading/error/not-found не добавлены
- **REP-25** (ОТКРЫТО) — Ошибочно созданную закупку нельзя отменить (UI только из delivered). Кнопка отмены в UI не добавлена
- **UI-001** (ЧАСТИЧНО) — Фиктивные «Экономия/-100 %/маржа/прогноз» при факте 0 (бюджет, портфель). Портфель: portfolioProjects.ts:40-45 даёт status under/«Экономия» при нулевом факте; BudgetBreakdown.tsx:43 показывает прогноз без проверки факта.
- **UI-007** (ЧАСТИЧНО) — Менеджер-сводка: «+18407733 ₽» без разделителей, сырая категория «other». Сырая категория в «Подбор: … | other» (backend client_write_side_effects.py body=row.category) не локализована.

Крупнейшие кластеры: (а) [закрыто] удаление аккаунта (ROLE-016, APIA-006); (б) закупки/материалы (EST-010/011/013/025/026, REP-13/25) — нет отмены, правки и честных состояний; (в) вывоз мусора (EST-015/016, APIB-012); (г) проверка самозанятости/НПД (MNY-029, APIA-008) — внешняя интеграция; (д) бюджет-планировщик (SCR-003/BUD-03) — ложный успех; (е) [закрыто] отзыв портал-токена (INB-04, миграция x07); (ж) UI исполнителя (REP-01/02/03, OBJ-05/07/16/32).

## 4. Новые находки проверки (нет в аудите)

- `apps/mobile/lib/compressImage.ts:3` — `compressDataUrl` (обрезка base64) больше нигде не вызывается, но остаётся экспортируемой ловушкой; удалить после проверки зависимостей.
- Остаточный риск APIB-001/002 (закрыты): magic-link портала по-прежнему stateless, без nonce/отзыва (INB-04); явный `ENVIRONMENT=development` с нелокальным URL/Postgres не блокируется; MKT-016 — в development остаётся fallback «исполнитель = админ».
- UI-027 частично устарела: «Экспорт данных» оказался выгрузкой собственных данных пользователя, а не админ-функцией.

- Замечание по запуску тестов: по сообщению одного из проверяющих, `pytest` без явного `ENVIRONMENT` падает на observability guard, так как значение по умолчанию теперь production (43de275c); тесты опираются на `backend/conftest.py`. Не перепроверено отдельно.
