# EAS workflow fix (2026-07-15)

**Репозиторий:** https://github.com/PetrFedin/renova

## Симптом

Каждый push на `develop`/`main` показывал failure job `.github/workflows/eas-build.yml` за **0 секунд** — workflow даже не стартовал.

## Корневая причина

Синтаксическая ошибка YAML в `expo/expo-github-action` step — незакрытая `}}`:

```yaml
with: { eas-version: latest, token: ${{ secrets.EXPO_TOKEN }}
```

GitHub отклонял файл workflow при валидации.

## Исправление

1. Валидный YAML + `workflow_dispatch` с inputs (`profile`, `platform`, `submit`)
2. Job `preflight` → `scripts/testflight-preflight.sh --ci` (без секретов)
3. Job `build` только при наличии `EXPO_TOKEN`; иначе `missing-token` с warning
4. `eas build --no-wait` — не блокирует runner на 20+ минут
5. Профиль по умолчанию: `testflight` / `ios`

## Проверка

- Push с исправленным файлом — **нет** автоматического запуска (только manual dispatch)
- Actions → EAS Build & Submit → Run workflow → preflight green

См. также `docs/TESTFLIGHT-PREP-RUNBOOK.md`.
