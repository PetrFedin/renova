# Renova — платформа управления ремонтом (iPhone-first)

**Repository:** https://github.com/PetrFedin/renova — отдельный продукт, не связан с [Syntha](https://github.com/PetrFedin/syntha).

Монорепо MVP: мобильное приложение для заказчика и исполнителя, backend API, движок расчётов смет.

## Стек

| Слой | Технология |
|------|------------|
| Mobile (iPhone) | Expo 56 + React Native + expo-router |
| Backend | FastAPI + SQLAlchemy 2 + PostgreSQL |
| Расчёты | `packages/calc-engine` (TypeScript, общий с mobile) |
| ФНС MVP | Публичный API статуса самозанятого + проверка чеков |
| ФНС v2 | Партнёрство «Мой налог» (SOAP/Open API после аккредитации) |

## Быстрый старт

```bash
# Backend
cd backend && poetry install && cp .env.example .env
poetry run uvicorn app.main:app --reload --port 8100

# iPhone (симулятор)
cd apps/mobile && npm install && npm run ios
```

## CI и локальные gates

```bash
npm run test:priority              # priority gate (~49 tests)
bash scripts/ci-playwright.sh api  # Playwright API E2E (backend via script)
npm run ci:playwright              # api + ui — как job playwright в CI
```

Подробнее: `docs/P3-W18-CI-PLAYWRIGHT-SCRIPT-2026-07-18.md`, `docs/P3-W19-CI-WORKFLOW-PUSH-2026-07-18.md`.

## Документация

- `docs/MVP-SPEC-RU.md` — полная спецификация MVP
- `docs/FNS-INTEGRATION-RU.md` — интеграция с ФНС и «Мой налог»
- `docs/UX-FLOWS-RU.md` — экраны и сценарии

## Роли

- **Заказчик** — бесплатно: проект, смета, контроль, приёмка
- **Исполнитель** — подписка: CRM, сметы, чеки НПД, рейтинг

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
