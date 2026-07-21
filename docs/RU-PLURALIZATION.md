# Русская плюрализация

Единый formatter: `apps/mobile/lib/i18n/` на базе `Intl.PluralRules('ru-RU')`.

## API

```ts
import { formatCount, pluralizeRu, formatBadgeCount, formatCompactCount, RU_NOUN } from '@/lib/i18n';

formatCount(21, RU_NOUN.task); // «21 задача»
pluralizeRu(11, RU_NOUN.task); // «задач»
formatBadgeCount(120); // «99+»
formatUnreadMessages(2); // «2 непрочитанных сообщения»
```

## Категории

`one` / `few` / `many` / `other` (+ `zero` fallback → many).

Обязательные кейсы: 0,1,2–4,5,11–14,21,22,111,121, −1, 1.5, NaN.

## Не делать

```ts
count === 1 ? 'задача' : count < 5 ? 'задачи' : 'задач' // ломает 11, 12, 14, 22…
```

## Тесты

```bash
npm run test:ru-plural
```
