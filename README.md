# Renova — платформа управления ремонтом (iPhone-first)

**Repository:** https://github.com/PetrFedin/renova — отдельный продукт, не связан с [Syntha](https://github.com/PetrFedin/syntha).

Монорепозиторий продукта: мобильное приложение для заказчика и исполнителя, backend API, dedicated worker, движок расчётов смет и production-operations контур.

## Стек

| Слой | Технология |
|------|------------|
| Mobile | Expo 56 + React Native + expo-router |
| Backend API | FastAPI + SQLAlchemy 2 + PostgreSQL |
| Durable worker | тот же immutable backend image, отдельный `renova-worker` process |
| Shared runtime | PostgreSQL + Redis + S3-compatible storage |
| Расчёты | `packages/calc-engine` (TypeScript, общий с mobile) |
| ФНС | публичный API статуса самозанятого + проверка чеков |
| «Мой налог» | OAuth/provider integration только в рамках документированного provider contract |

## Engineering source of truth

Перед разработкой читать:

- `AGENTS.md` — канонический engineering context: branching, runtime, transactions, outbox, finance, security, navigation и Definition of Done;
- `.cursor/rules/renova-git-sync.mdc` — актуальный Git/GitHub workflow;
- `.cursor/rules/renova-design-system.mdc` — mobile UI canon;
- `docs/DEVELOPMENT-CANON.md` — environment/evidence/development rules;
- `PRODUCTION-READINESS.md` — текущий launch verdict и границы доказанного;
- `docs/production-readiness-evidence.json` — machine-readable readiness evidence.

Исторические MVP/audit документы не являются текущим source of truth.

## Branching

Канонический flow:

`main` → short-lived feature/fix/refactor/agent branch → PR → relevant CI/evidence → merge to `main`.

`develop` и старые `feature/task-18...24` — historical/stale, не использовать как базу новой разработки.

> Внешний P0 governance остаётся открытым, пока GitHub реально не применит branch protection/ruleset для `main` и negative test не докажет enforcement. Green CI сам по себе не означает, что direct push уже запрещён.

## Локальная разработка — текущая правда

Backend dependency contract должен совпадать с CI:

```bash
python -m pip install "poetry==2.4.1"
cd backend
poetry check --lock
poetry sync --no-interaction
poetry run pip check
```

Текущий ручной запуск API:

```bash
cd backend
cp .env.example .env
poetry run uvicorn app.main:app --reload --port 8100
```

Mobile:

```bash
cd apps/mobile
npm ci
npm run ios
```

### Known P1 local-runtime gap

Текущий `npm run dev` / `scripts/start-dev.sh` **ещё не является production-topology-complete local runtime**: он не поднимает полный PostgreSQL + Redis + MinIO + API + Worker stack и содержит legacy best-effort migration/package-install behavior. Не использовать его успешный старт как evidence эквивалентности staging/production.

Canonical local runtime должен быть исправлен отдельным production-hardening change: migration fail-fast, locked dependencies, PostgreSQL + Redis + MinIO + API + worker health/heartbeat, затем Expo. До этого ограничения считаются известным P1 development gap, а не «готовой» средой.

## CI и локальные gates

```bash
npm run test:priority              # priority regression subset
bash scripts/ci-playwright.sh api  # Playwright API E2E
npm run ci:playwright              # API + UI Playwright surface
npm run typecheck:mobile           # mobile type contract
```

Полный backend regression, PostgreSQL Alembic upgrade и canonical PR gates выполняются в GitHub Actions. Малый локальный subset не является эквивалентом полного CI evidence.

## Runtime architecture

Production-oriented topology:

`Mobile → API/Auth/Project ACL → PostgreSQL authoritative state → atomic transaction → audit + Domain Outbox → dedicated worker → external providers → reconciliation/health/recovery`.

Durable provider/background jobs не должны жить в API process как единственный execution path.

## Production readiness

- **`PRODUCTION-READINESS.md` — текущий source of truth по broad-production readiness, evidence и launch blockers.**
- `docs/production-readiness-evidence.json` — reviewable machine-readable evidence manifest; SHA-bound snapshot генерируется CI.
- Green repository CI не доказывает external staging, managed restore, live providers, TestFlight/App Store release, legal approval или penetration test.

## Исторические документы

- `docs/FULL-PROJECT-AUDIT-2026-07-31.md` — исторический аудит на 31.07.2026; не использовать как текущий readiness status.
- `docs/FULL-PROJECT-AUDIT-WAVE-X-CHECKLIST.md` — исторический/рабочий checklist; launch verdict берётся из production readiness.
- `docs/MVP-SPEC-RU.md` — историческая исходная спецификация; не источник текущей архитектуры.
- `docs/FNS-INTEGRATION-RU.md` — provider/integration reference, актуальность сверять с кодом и readiness evidence.
- `docs/UX-FLOWS-RU.md` — UX reference, при конфликте route registry/current mobile implementation имеют приоритет.

## Роли

Основные продуктовые роли:

- **Заказчик** — проект, объект, смета/бюджет, согласования, контроль, приёмка, оплаты и документы.
- **Исполнитель** — подключение к проекту, сметы/работы, материалы, документы, технический контроль, платежные/provider операции в рамках полномочий.
- Дополнительные ACL-роли и operator/admin boundaries определяются backend authorization rules; UI не является источником права доступа.

## Навигация (IA)

Канон: `apps/mobile/lib/routeRegistry.ts`.

- **Dock:** Главная · Сообщения · Объект · Ремонт · Бюджет/Деньги.
- **Сроки:** единый `/calendar` hub, optional/secondary entry согласно route registry.
- **Приёмка:** через `Ремонт → Приёмка`, а не отдельный competing hub.
- **Финансы:** через Бюджет/Деньги; legacy finance-center только redirect.
- **Уведомления/attention:** через `/inbox`.
- Secondary functions не должны создавать новые дублирующие top-level product areas.

## Канон локальных копий

| Папка | Назначение | Правило |
|-------|------------|---------|
| **`renova/`** | канон разработки | править здесь |
| `renova-os/` | локальное Git-зеркало | не считать отдельным source of truth |
| `renova v1/` | архивный снимок | не использовать для новых функций |

Любой старый локальный snapshot, stale branch или old PR сначала сравнивать с current `main`; не переносить legacy behavior обратно без red-team проверки.