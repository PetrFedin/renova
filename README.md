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

- `AGENTS.md` — **единый authoritative engineering context** для человека, Cursor и Claude Code: branching, local runtime, transactions, outbox, finance, security, navigation и Definition of Done;
- `CLAUDE.md` — короткий bootstrap-pointer на `AGENTS.md`, не отдельный набор правил;
- `.cursor/rules/renova-agent-runtime.mdc` — bootstrap-pointer Cursor на тот же `AGENTS.md`;
- `.cursor/rules/renova-git-sync.mdc` — Git/GitHub bootstrap-pointer на соответствующие разделы `AGENTS.md`, не отдельный policy source;
- `.cursor/rules/renova-design-system.mdc` — scoped mobile UI canon для файлов интерфейса;
- `docs/DEVELOPMENT-CANON.md` — environment/evidence/development reference; при policy-конфликте приоритет у `AGENTS.md` и текущего кода/CI;
- `PRODUCTION-READINESS.md` — текущий launch verdict и границы доказанного;
- `docs/production-readiness-evidence.json` — machine-readable readiness evidence.

Исторические MVP/audit документы не являются текущим source of truth.

## Branching

Канонический flow:

`main` → short-lived feature/fix/refactor/agent branch → PR → relevant CI/evidence → merge to `main`.

`develop` и старые `feature/task-18...24` — historical/stale, не использовать как базу новой разработки.

> Внешний P0 governance остаётся открытым, пока GitHub реально не применит branch protection/ruleset для `main` и negative test не докажет enforcement. Green CI сам по себе не означает, что direct push уже запрещён.

## Канонический локальный запуск

Локальная среда намеренно повторяет backend topology продукта, но остаётся **development-only**:

`PostgreSQL + Redis + MinIO + API + dedicated Worker + Expo`.

Первый запуск после clone или изменения lock-файлов:

```bash
npm run dev -- doctor
npm run dev -- bootstrap
npm run dev
```

`bootstrap` — отдельный явный этап установки locked dependencies. Обычный `npm run dev` **не устанавливает пакеты**, не вызывает ad-hoc `pip install` и не проглатывает ошибки миграций.

Проверка уже поднятой среды:

```bash
npm run dev -- check
```

`check` fail-fast проверяет PostgreSQL, Redis, MinIO, `/health`, `/ready`, Alembic head, локальный worker heartbeat, shared Redis worker heartbeat и показывает mobile API URL.

Полезные команды:

```bash
npm run dev -- seed          # idempotent development-only demo seed
npm run dev -- test-focused  # быстрый contract/runtime gate
npm run dev -- test-full     # полный локальный backend/mobile regression
npm run dev -- logs
npm run dev -- stop
npm run dev -- reset         # УДАЛЯЕТ только local development volumes
```

Для Cursor/Claude Code и non-interactive backend verification без Expo:

```bash
RENOVA_DEV_NO_EXPO=1 npm run dev
npm run dev -- check
npm run dev -- test-focused
```

### Env boundary

Canonical local profile: `env.local.example` → ignored `.env.local`. При первом вызове dev-команды файл создаётся автоматически, если отсутствует.

Не использовать для локального запуска:
- `env.staging.example`;
- `backend/.env.staging.example`;
- `.env.production*`;
- реальные provider/staging/production credentials.

Успешный local runtime — это только local `TESTED` evidence. Даже green local-runtime Actions — только `CI VERIFIED` для exact candidate, а не доказательство external staging/production.

## CI и verification gates

```bash
npm run dev -- test-focused      # canonical fast local gate
npm run dev -- test-full         # broader local backend/mobile regression
npm run test:priority            # historical/priority regression subset
bash scripts/ci-playwright.sh api
npm run ci:playwright
npm run typecheck:mobile
```

Полный GitHub CI, PostgreSQL Alembic lifecycle, dedicated concurrency/E2E/security/release workflows остаются authoritative CI evidence для соответствующих изменений. Локальный SQLite test-subset внутри `test-focused`/`test-full` не заменяет dedicated PostgreSQL race/migration evidence.

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
