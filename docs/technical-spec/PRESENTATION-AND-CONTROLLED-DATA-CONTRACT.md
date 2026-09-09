# RENOVA — presentation/review environment without demo business logic

**Статус:** ACTIVE / PRODUCT CONTRACT.
**Цель:** позволить владельцу, инвестору, партнёру или QA увидеть максимум продукта на реалистичных данных, не создавая отдельную «демо RENOVA», которая работает иначе, чем настоящий продукт.

---

# 1. Основное правило

> **Presentation is a dataset/environment concern, not a second business implementation.**

Разрешено:
- controlled seeded accounts/projects;
- deterministic scenario presets;
- simulated external providers;
- review-only launcher/role selector;
- reset/reseed tools in explicitly permitted environment.

Запрещено:
- `demo=True` для бизнес-успеха;
- hardcoded paid/signed/accepted status;
- static cards, не связанные с domain entities;
- bypass auth/ACL для customer/contractor buttons;
- отдельный «demo project service»;
- fake API response, если ordinary service должен работать;
- кнопка, которая только меняет local state и создаёт впечатление реальной mutation;
- production access к destructive seed/reset tooling.

---

# 2. Review launcher

Для controlled review environment допустим стартовый launcher до project context.

Минимальная структура:

```text
RENOVA Review

1. Выберите роль
   - Заказчик
   - Исполнитель

2. Выберите сценарий
   - Первый запуск / нет проекта
   - Активный ремонт
   - Несколько исполнителей
   - Проект с проблемами/просрочками
   - Финансовые отклонения
   - Приёмка и доработка
   - Завершённый проект / гарантия

3. Открыть продукт
```

Launcher:
- создаёт/выбирает controlled account/session по review contract;
- не меняет backend business rules;
- после входа пользователь находится в обычной navigation/application shell;
- selected scenario определяет seeded data, а не иной код UI;
- customer и contractor datasets должны быть связаны одним реальным Project там, где сценарий предполагает взаимодействие.

В обычном production first-run этот launcher не обязан существовать; он не подменяет обычную регистрацию/логин.

---

# 3. Controlled datasets

Нужен не один «красивый проект», а набор состояний, покрывающий lifecycle.

## D0 — first use

Customer:
- account;
- zero projects;
- clean empty state;
- create project CTA.

Contractor:
- profile;
- no projects;
- eligible lead examples or direct invite path according to scenario.

Purpose: proof that product starts from zero without fabricated project.

## D1 — active healthy project

Contains:
- rooms/plan;
- approved estimate;
- schedule;
- one contractor;
- material selections;
- purchases/deliveries;
- messages;
- documents;
- accepted and in-progress stages;
- payments/receipts with coherent plan/fact.

## D2 — multi-contractor project

Contains:
- 2–3 independent principals;
- non-overlapping and shared context scopes;
- cross-principal dependencies;
- separate payee/document/chat visibility;
- aggregate customer schedule/budget;
- negative sibling access assertions.

## D3 — problem project

Contains controlled realistic issues:
- overdue stage;
- material blocker;
- rejected acceptance/rework;
- pending customer decision;
- unknown/stale data state where appropriate;
- failed notification/provider operation visible to operator, not fabricated as user success.

Purpose: show decision support, not just ideal green cards.

## D4 — finance project

Contains:
- Original;
- approved ChangeOrder/Revised;
- commitment;
- recognized actual;
- pending and successful payments;
- refund/dispute example;
- receipt/evidence;
- unavailable fact example.

All totals must reconcile.

## D5 — closeout/warranty

Contains:
- accepted stages;
- completed handover docs;
- closed payment state;
- archived/completed project;
- warranty claim with historical contractor responsibility.

---

# 4. Customer presentation journey

Recommended story, using ordinary app behavior:

1. Role/scenario selection in review launcher.
2. Home: attention and project status.
3. Object: rooms/plan/estimate/design.
4. Marketplace/participants: contractor(s) and scopes.
5. Repair: schedule/work/progress/evidence.
6. Material decision: approve/reject/analog.
7. Purchase/delivery: partial quantity and receipt.
8. Acceptance: submission → issue/rework → accept.
9. Money: Original/Revised/Committed/Actual/Paid/Refund.
10. Documents: version/signature/download.
11. Chat/inbox: task/invoice source links.
12. Warranty/closeout.

Every interactive mutation is real within the seeded dataset and persists/reconciles normally.

---

# 5. Contractor presentation journey

1. Review launcher contractor role.
2. Leads/direct invites.
3. Quote or existing selected project.
4. My projects from ProjectParticipant authority.
5. Exact assigned scope.
6. Schedule/work order.
7. Material proposal/purchase responsibility.
8. Progress/photo/evidence.
9. Submit for review.
10. Rework/resubmit.
11. Invoice/payment status.
12. Own documents/signature.
13. Warranty obligation if scenario D5.

Contractor view must prove sibling isolation in D2.

---

# 6. External provider simulation

Simulator is allowed only behind same port used by real adapter later.

Examples:

### Payment
`create → pending → success/cancel/refund → webhook/status → reconciliation`.

### Fiscal
`valid / mismatch / not_found / timeout / rate_limited`.

### E-sign
`created → pending → signed/rejected/expired → reconciliation`.

### Notification
`queued → provider accepted → delivered/failed` where channel supports receipts.

User UI may say `simulated/test environment` in review context, but domain transition must be identical to real port contract.

---

# 7. Failure-state review controls

Review/QA tooling may deterministically induce:
- provider timeout;
- response loss;
- webhook duplicate/out-of-order;
- network offline;
- stale cache;
- access revoked;
- version conflict;
- notification delivery failure;
- S3/storage ambiguity only in safe test harness;
- app restart with queued intent.

These controls live outside ordinary customer action UI and invoke the same recovery paths tested in product.

---

# 8. UI state matrix for screenshots/review

For each critical surface capture where applicable:

- loading;
- empty;
- success;
- error;
- offline;
- stale;
- queued;
- unknown/reconciling;
- conflict;
- access revoked;
- post-commit refresh failed;
- long Russian text/small screen/accessibility scaling.

A browser iPhone-size screenshot proves web layout only. Native iOS/Android file/share/permissions/push require device/build evidence.

---

# 9. Seed invariants

Seed must be:
- explicit dev/review only;
- idempotent or reset under explicit destructive command;
- referentially consistent;
- financially reconciled;
- deterministic enough for automated tests;
- realistic enough for product review;
- free from real personal secrets/credentials;
- versioned with scenario schema.

Seed should create the same domain entities ordinary APIs use. It must not create impossible states except specifically labelled negative fixtures that tests need.

---

# 10. Anti-dead-end acceptance

For every CTA visible in review environment:

1. route exists;
2. role has correct access;
3. data exists for scenario or honest empty state is shown;
4. action has terminal outcome;
5. errors/retry are handled;
6. mutation persists server-side or is honestly queued;
7. follow-up read displays result;
8. notification/inbox/deeplink works where expected;
9. no placeholder alert such as «скоро» on canonical core flow;
10. if external provider is off, capability is unavailable with explanation, not fake success.

Automated review test should inventory visible critical CTAs and classify them. Goal is **zero unclassified customer/contractor core actions**, not arbitrary zero route count.

---

# 11. Investor/partner presentation truth

During investor/bank/retailer presentation:

- clearly distinguish implemented/verified from future integration;
- simulated provider is identified as simulator;
- future partner opportunity is shown through internal data/port contract, not fake partner logo transaction;
- numbers shown on dashboard are computed from seeded canonical facts;
- project story includes problem/recovery, not only perfect state;
- customer and contractor views show the same underlying project from different scopes.

This makes presentation stronger: the investor sees a functioning transaction graph rather than a click-through prototype.

---

# 12. Definition of Done for review environment

Review environment is ready only when:

- role/scenario launcher works in intended review environment;
- D0–D5 load reliably;
- customer and contractor connected scenarios share canonical data;
- no business mutation bypass exists;
- all core visible actions are classified and tested;
- financial seed reconciles;
- provider simulators use normal ports;
- reset/reseed cannot run in prohibited runtime;
- screenshot/state matrix exists;
- web/native evidence is labelled correctly;
- production product does not depend on review launcher.

**Review-ready ≠ production-ready.** It proves product behavior on controlled infrastructure; external staging, real providers, device distribution, security/pilot/legal gates remain separate.