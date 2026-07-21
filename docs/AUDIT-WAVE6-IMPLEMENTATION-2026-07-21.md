# Audit wave-6 — closure sweep (2026-07-21)

## Зачем

Добить остаток «silent swallow» после wave-5 и зафиксировать матрицу закрытия аудита.

## Что сделано

- ~89 замен `.catch(() => {})` → `reportCatch('…')` по mobile UI/hooks
- ~28 list-load `.catch(() => setX([]|null|0))` → `reportError` + прежнее fallback-значение
- `docs/AUDIT-CLOSURE-MATRIX-2026-07-21.md` — единый ответ «всё ли внесено»

## Тест

```bash
npx tsx apps/mobile/lib/silentCatch.w146.test.ts
```
