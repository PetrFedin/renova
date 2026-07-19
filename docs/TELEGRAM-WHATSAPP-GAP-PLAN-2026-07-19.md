# Telegram / WhatsApp — gap plan (2026-07-19)

## Статус MVP (honesty)

| Канал | В продукте | Не в MVP |
|-------|------------|----------|
| In-app чат Renova | ✅ | — |
| Portal magic link | ✅ | — |
| System Share → WA/TG | ✅ (OS sheet) | — |
| WhatsApp Business API | ❌ | sync сообщений, шаблоны |
| Telegram Bot API | ❌ | бот-уведомления |

## Почему не «ещё фича»

Интеграция WA Business / TG Bot = отдельный compliance + ключи + поддержка.  
Для пилота достаточно: **ссылка портала / код объекта / Team QR** через «Поделиться».

## Путь пользователя

1. Заказчик → гость: portal link → Share → WhatsApp/Telegram.  
2. Заказчик → исполнитель: код объекта → Share.  
3. Бригада: Team QR → Share / сканер.  
4. Операционка ремонта — **чат Renova**, не переписка в WA.

## Следующий квартал (H2+), если MRR

1. WA Business templates: «счёт к оплате», «приёмка готова» (opt-in).  
2. TG bot: deep link на portal + push mirror.  
3. Никогда не дублировать SoT чата вне Renova.
