# DEV-SETUP: локальные e2e (Playwright)

Общий запуск окружения — см. `docs/DEVELOPMENT-CANON.md` (раздел 5, `npm run dev`). Здесь только e2e.

## 1. Установка браузера Playwright

Браузер не ставится вместе с `npm ci`; без него UI-specs падают с «Executable doesn't exist».

```bash
npm ci
npx playwright install chromium            # локально
npx playwright install --with-deps chromium  # Linux/CI (системные библиотеки)
```

API-specs (`request`-фикстура) браузер не требуют; UI-specs (`page`) — требуют.

## 2. Запуск

Нужны API на `:8100` и (для UI-specs) Expo web на `:8081`. Адреса переопределяются
`RENOVA_API` / `RENOVA_WEB`.

```bash
# как в CI: поднимает изолированный API (sqlite, ENVIRONMENT=test) + seed + (для ui) Expo web
bash scripts/ci-playwright.sh api     # API-specs
bash scripts/ci-playwright.sh ui      # UI-specs
bash scripts/ci-playwright.sh all

# против уже запущенного dev-стека
npx playwright test -c e2e/playwright.config.ts e2e/room-lifecycle.spec.ts
npx playwright test -c e2e/playwright.config.ts e2e/deep-link-cold-start.spec.ts   # нужен :8081
npx playwright test -c e2e/playwright.config.ts --list                             # проверка discovery
```

`workers: 1` — все specs используют одного demo-заказчика/исполнителя; параллельный прогон
ломает бюджет (scan/delete) и упирается в лимит ниже.

## 3. Лимит 400 rpm и как избегать 429

API ограничивает запросы **на пользователя** (ключ `user:<id>` из JWT, иначе IP) за окно 60 с
(`backend/app/middleware/rate_limit.py`). В `development`/`test` лимит `max(RATE_LIMIT_RPM, 400)`,
в staging/production — `RATE_LIMIT_RPM` (по умолчанию 120). Все e2e работают под одним demo-пользователем,
поэтому у них общий бюджет: ответ `429 {"detail":"rate_limit"}` с `Retry-After`.

Как не упираться:

- не гоняйте полный набор подряд несколько раз в минуту и не запускайте два прогона одновременно;
- не ставьте `workers > 1` и не добавляйте `Promise.all` с десятками запросов к одному пользователю;
- вместо опроса в цикле используйте `expect.poll` с интервалом ≥ 1 с;
- переиспользуйте один токен `/auth/demo` внутри теста, не логиньтесь на каждый запрос;
- UI-specs открывают много экранов: запускайте их по одному файлу (`deep-link-cold-start.spec.ts` ждёт 7 с на кейс именно поэтому);
- при 429 подождите `Retry-After` секунд и повторите только упавший файл; повышать лимит в staging ради e2e нельзя.

## 4. Гигиена данных: e2e не должны засорять демо

Демо-вход (`/auth/demo`) выдаёт общего заказчика, отдельные учётки через API не создаются (регистрация по OTP),
поэтому specs убирают за собой сами через хелперы из `e2e/helpers.ts`:

```ts
import { trackE2eProject, createE2eChat, cleanupE2eArtifacts } from './helpers';

test.afterAll(async () => { await cleanupE2eArtifacts(); });   // корзина проектов + архив чатов

const pid = trackE2eProject(createdProjectId, hCust);          // созданный тестом проект
await createE2eChat(request, cust, demoProjectId, 'UAT checklist'); // чат в demo-проекте
```

Правила: проекты создавайте с `address`, начинающимся с `E2E` (маркер для чистильщика), чаты в «Демо-квартире»
создавайте только через `createE2eChat`, объект «Демо-…» никогда не trash/archive/delete.

### Чистка накопленного мусора в dev-БД

```bash
cd backend
# dry-run по умолчанию: только список кандидатов, ничего не меняется
DATABASE_URL=<dev-БД> env -u ENVIRONMENT .venv/bin/python -m scripts.cleanup_e2e_demo_data
# удаление — только явно
DATABASE_URL=<dev-БД> env -u ENVIRONMENT .venv/bin/python -m scripts.cleanup_e2e_demo_data --apply
```

Скрипт не трогает проекты `Демо-…` и канонические демо-чаты; проекты с финансовой историей/подписями
не удаляет, а переносит в корзину.
