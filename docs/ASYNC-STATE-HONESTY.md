# Async state honesty

Ошибка API **не** маскируется под `[]` / `null` / `0` / «Ничего нет».

## Модель

```ts
type AsyncResource<T> = {
  data: T | null;
  status: 'idle' | 'loading' | 'refreshing' | 'success' | 'empty' | 'stale' | 'offline' | 'error';
  error: AppError | null;
  updatedAt: number | null;
  contextKey: string;
};
```

- Первый load + ошибка → `error` + `InlineError`
- Успех + пусто → `empty` + `EmptyState`
- Refresh fail при data → `stale` + `StaleDataBanner` (данные сохраняются)
- Смена `contextKey` → старые данные не считаются новыми
- Offline + cache → `offline` + banner; без cache → offline error
- Retry не очищает предыдущие data

## API

- `lib/async/` — `normalizeAppError`, `reduceAsyncResource`, `useAsyncResource`
- `components/async/` — `InlineError`, `StaleDataBanner`, `RetryButton`, `EmptyState`, `LoadingSkeleton`, `AsyncResourceBlock`

## Подключено

Calendar/schedule, Week strip, Selections, Control, Approvals, Work orders, Activity, today-task badge, Documents warranty list.

Тесты: `npm run test:async-honesty`
