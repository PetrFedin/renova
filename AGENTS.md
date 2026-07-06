# Renova v1.1
Stack: Expo 56 + FastAPI + SQLite/PostgreSQL + calc-engine
Run: `cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --port 8100`
Demo: POST /api/v1/auth/demo {role: customer|contractor} — без ввода данных
PostgreSQL: `docker compose up -d` → DATABASE_URL=postgresql+asyncpg://renova:renova@localhost:5433/renova


## v1.2 — комнаты, этапы, финансы, план

### Новые модели
- Room: outlets_count, switches_count, plumbing_points, room_type
- Stage: planned_start/end, contractor_ready, customer_accepted_at
- StageComment, StagePhoto, Payment (advance/stage/material/final)

### API
- GET/PATCH `/projects/{id}/rooms/{room_id}` — габариты + авто-строки сметы (electrical/plumbing)
- GET `/projects/{id}/plan` — календарь этапов
- GET/POST `/projects/{id}/stages/{id}/comments|photos|ready`
- GET/POST `/projects/{id}/payments`, POST `.../confirm`

### Mobile
- Вкладки: Комнаты, План, Финансы (заказчик); Комнаты, План (исполнитель)
- Экран `/stage/[id]` — комментарии, фото, приёмка
