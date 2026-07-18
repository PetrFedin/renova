# P3-W27 — offline guards расширены

## Изменения

- **rooms** — updateRoom + createRoomChangeRequest: offline только при сетевой ошибке
- **receipts** — manual/scan: не enqueue при 4xx
- **stages** — comment/photo: ApiError rethrow
- **chats** — sendMessage: ApiError rethrow
- **PaymentDetailSheet** — понятнее demo vs staging без ключей

## DoD

- `npm run test:priority` PASS
