# TestFlight notes — Renova 0.2.0 (draft)

**Build target:** Expo / iOS TestFlight  
**Git:** branch `main` после merge `develop` (пакет Wave 2–3b)  
**API:** staging с `ENVIRONMENT=staging`, Postgres, `alembic upgrade head`

## What to Test (RU для тестировщиков)

1. **Вход / роли** — customer и contractor видят только свои проекты.
2. **Приёмка этапа** — accept → акт появляется в документах; следующий этап разблокируется при оплате.
3. **Документы**
   - загрузка файла (фото/PDF/txt)
   - архив / restore
   - чужой проект → «не найдено» (не 403 с утечкой)
   - гость (viewer) читает, писать не может
4. **Legal hold** (если включён в debug/API) — удаление документа блокируется.
5. **Подпись in-app** — успех; **Контур** — только если на API включён sandbox/live (иначе «недоступен»).
5b. **Upload** — web и native DocumentPicker / фото.
6. **Офлайн** — действие в airplane mode кладётся в очередь; после сети — sync (без дублей 409).
7. **План vs факт** — карточка графика = план; % этапа = факт.

## Known Limitations

- OCR тип документа — эвристики по имени, не полный OCR.
- Kontur / Госключ — по умолчанию 501; staging может включить sandbox (`KONTUR_MODE`).
- Demo seed только на development; staging без seed.
- Платежи ЮKassa — stub/keys через env.

## Build notes (Expo)

```text
Renova 0.2 — Document Center, offline queue, staging guards.
Please verify: upload docs, guest read-only, stage acceptance → act, offline sync.
```

## Rollback

Откат мобильного билда в App Store Connect; API — предыдущий Docker image / git tag.  
Миграции OCR/legal_hold обратно совместимы (nullable / server_default) — downgrade только по необходимости.

## Updated 2026-07-15

Includes develop waves through **3f** (DocumentPicker + Kontur scaffold).
