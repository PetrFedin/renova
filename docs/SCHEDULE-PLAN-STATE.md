# Schedule plan state truth

`null` active schedule **не** равен «план не создан», если это ошибка сети/сервера.

## Состояния

`idle | loading | not_created | draft | submitted | confirmed | rejected | stale | forbidden | error`

- **not_created** — только после успешного `200 null` или `404`
- **error / forbidden** — без CTA «Создать план»
- **stale** — предыдущий план + баннер после refresh fail / offline cache
- смена проекта: `contextKey` + abort предыдущего запроса

## API

`getActiveWorkSchedule` / `fetchActiveSchedulePlan` с `cacheFallback: false`,
чтобы durable cache не выдавал cached `null`/plan за успешный ответ при 5xx.

Backend: `GET .../work-schedules/active` → `WorkSchedule | null` (явное отсутствие).

Тесты: `npm run test:schedule-plan-truth`
