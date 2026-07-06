# Renova — платформа управления ремонтом (iPhone-first)

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

## Документация

- `docs/MVP-SPEC-RU.md` — полная спецификация MVP
- `docs/FNS-INTEGRATION-RU.md` — интеграция с ФНС и «Мой налог»
- `docs/UX-FLOWS-RU.md` — экраны и сценарии

## Роли

- **Заказчик** — бесплатно: проект, смета, контроль, приёмка
- **Исполнитель** — подписка: CRM, сметы, чеки НПД, рейтинг

## Синхронизация renova ↔ renova-os (GitHub)

| Папка | Назначение |
|-------|------------|
| `renova/` | Рабочая копия (dev, node_modules, .venv) |
| `renova-os/` | Git-зеркало → https://github.com/PetrFedin/renova |

```bash
npm run sync:os              # renova → renova-os
npm run sync:os:from         # renova-os → renova (после git pull)
npm run sync:os:watch        # автосинхронизация при изменениях (poll)
npm run sync:os:push         # sync + commit + push на GitHub
npm run sync:os:daemon:install   # фон каждые 60 сек (launchd macOS)
npm run sync:os:daemon:uninstall # остановить фон
```

Лог фоновой синхронизации: `renova-os/.sync.log`
