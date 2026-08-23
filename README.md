# Renova — платформа управления ремонтом (iPhone-first)

**Repository:** https://github.com/PetrFedin/renova — отдельный продукт, не связан с [Syntha](https://github.com/PetrFedin/syntha).

Монорепозиторий продукта: мобильное приложение для заказчика и исполнителя, backend API, движок расчётов смет и production-operations контур.

## Стек

| Слой | Технология |
|------|------------|
| Mobile (iPhone) | Expo 56 + React Native + expo-router |
| Backend | FastAPI + SQLAlchemy 2 + PostgreSQL |
| Расчёты | `packages/calc-engine` (TypeScript, общий с mobile) |
| ФНС | Публичный API статуса самозанятого + проверка чеков |
| «Мой налог» | OAuth/provider integration после получения реальных partner credentials |

## Быстрый старт

```bash
# Backend: используем тот же lock contract, что и CI
python -m pip install "poetry==2.4.1"
cd backend && poetry check --lock && poetry sync --no-interaction && cp .env.example .env
poetry run uvicorn app.main:app --reload --port 8100

# iPhone (симулятор)
cd apps/mobile && npm ci && npm run ios
```

## CI и локальные gates

```bash
npm run test:priority              # priority gate
bash scripts/ci-playwright.sh api  # Playwright API E2E (backend via script)
npm run ci:playwright              # api + ui — как job playwright в CI
```

## Документация

- **`PRODUCTION-READINESS.md` — текущий source of truth по production readiness, evidence и launch blockers.**
- `docs/production-readiness-evidence.json` — reviewable machine-readable evidence manifest; SHA-bound snapshot генерируется CI.
- `docs/FULL-PROJECT-AUDIT-2026-07-31.md` — исторический аудит состояния на 31.07.2026; не использовать как текущий readiness status.
- `docs/FULL-PROJECT-AUDIT-WAVE-X-CHECKLIST.md` — исторический/рабочий checklist security/product/ops волн; текущий launch verdict берётся из production readiness.
- `docs/MVP-SPEC-RU.md` — историческая исходная спецификация продукта.
- `docs/FNS-INTEGRATION-RU.md` — интеграция с ФНС и «Мой налог».
- `docs/UX-FLOWS-RU.md` — экраны и сценарии.

## Роли

- **Заказчик** — проект, смета, контроль, приёмка.
- **Исполнитель** — CRM, сметы, чеки НПД, рейтинг, подписка.

## Синхронизация и канон копий

| Папка | Назначение | Правило |
|-------|------------|---------|
| **`renova/`** | **Канон** — вся разработка | Править только здесь |
| `renova-os/` | Git-зеркало → https://github.com/PetrFedin/renova | Только `npm run sync:os*` — не править вручную |
| `renova v1/` | **Архивный снимок** (~2026-07-08) | Не использовать для фич; можно удалить локально |

```bash
npm run sync:os              # renova → renova-os
npm run sync:os:from         # renova-os → renova (после git pull)
npm run sync:os:watch        # автосинхронизация при изменениях (poll)
npm run sync:os:push         # sync + commit + push на GitHub
npm run sync:os:daemon:install   # фон каждые 60 сек (launchd macOS)
npm run sync:os:daemon:uninstall # остановить фон
```

Лог фоновой синхронизации: `renova-os/.sync.log`

## Навигация (IA)

- **Dock:** Главная · Сообщения · Объект · Ремонт · Деньги
- **Шапка «Ещё»:** Сроки · Входящие · Документы · Архив (без дубля dock)
- **Приёмка:** только `Ремонт → Приёмка` (не отдельный пункт меню)
- **Деньги:** только dock «Деньги» / Бюджет (finance-center = redirect)
- **Сроки:** один hub `/calendar`
- **Уведомления:** через `/inbox` (Входящие)
