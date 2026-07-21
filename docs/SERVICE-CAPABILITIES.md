# Service capabilities — truthful modes

**Цель:** UI не выдумывает DEMO/LIVE. Backend health — единственный SoT.

## Контракт

```ts
type ServiceMode = 'live' | 'sandbox' | 'local' | 'demo' | 'off' | 'error';
type ServiceCapability = {
  available: boolean;
  mode: ServiceMode;
  provider?: string | null;
  configured: boolean;
  healthy: boolean;
  message?: string | null;
  checked_at?: string | null;
};
```

Расширения по сервису (обратная совместимость health):

| Сервис | Endpoint | Extra |
|--------|----------|--------|
| OCR | `GET /api/v1/ocr/health` (+ `capability` на `/ocr/worker`) | `run_allowed`, `worker_mode` |
| Мой налог | внутри `GET /api/v1/fns/health` → `moy_nalog` | `oauth_configured`, `connection_available`, `dev_bypass_available` |
| E-sign | `GET /api/v1/esign/health` | существующие поля Kontur |

## OCR modes

| `DOCUMENT_OCR_PROVIDER` | `DOCUMENT_OCR_ENABLED` | `mode` | `available` |
|-------------------------|------------------------|--------|-------------|
| `heuristic` / `local` / `stub` | true | `local` | true |
| `demo` | true | `demo` | true |
| `none` / `off` | * | `off` | false |
| * | false | `off` | false |
| неизвестный cloud без credentials | true | `error` | false |

Правила UI:

- Чип **DEMO** только при `mode === 'demo'` с backend.
- `mode=off` → «OCR не настроен».
- `available=false` → кнопка OCR disabled + retry health.
- HTTP 200 у health ≠ «сервис доступен»: смотри `available` / `healthy`.

Секреты и внутренние URL в response не отдаются.

## «Мой налог» bypass

Env: `MY_NALOG_DEV_BYPASS_ENABLED` (alias `MOY_NALOG_DEV_BYPASS_ENABLED`).

| ENVIRONMENT | flag=true | bypass |
|-------------|-----------|--------|
| development / test | true | разрешён |
| development / test | false | запрещён |
| staging / production | true или false | **всегда запрещён** |

- Startup `validate_runtime_settings` падает, если bypass=true вне demo-seed профилей.
- `POST /fns/moy-nalog/link` → 403 + audit `moy_nalog_bypass_denied` без токенов/PII.
- Admin role **не** открывает bypass.
- Production UI не показывает «Включить флаг (без OAuth)» (`dev_bypass_available=false`).

## Release checklist (capability truth)

- [ ] Staging/prod: `MY_NALOG_DEV_BYPASS_ENABLED` отсутствует или `false`; startup не падает.
- [ ] `GET /api/v1/ocr/health` → mode соответствует `DOCUMENT_OCR_*` (не hardcoded DEMO в mobile).
- [ ] Document Center: при `available=false` OCR action недоступен; retry работает.
- [ ] Профиль исполнителя: bypass-кнопка только если `moy_nalog.dev_bypass_available`.
- [ ] Запрещённый `POST …/moy-nalog/link` → 403 и запись audit.
- [ ] Response/logs health не содержат client_secret / passwords / internal URLs.
