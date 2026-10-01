# Живой аудит 2 (headless Playwright, обе роли, 375/768/1280)

Среда: Expo web localhost:8081, backend 127.0.0.1:8100, проект «AUDIT2 Квартира». Скриншоты вне репозитория (scratchpad).
Ранее исправлено предыдущим проходом: cea3ed20 (Bearer на /auth/me при холодном старте), 56de9ed8 (цикл «Maximum update depth» в портфеле), 2ae15cd0 (catch-all устаревших вкладок).

## Исправлено

### LA2-01 (P0, исправлено) Прямая ссылка на вкладку при живой сессии бросала на главную
- Симптом: холодное открытие `/object?tab=estimate`, `/profile`, `/repair?tab=materials`, `/budget`, `/calendar`, `/chat` через ~5 с заканчивалось на `/` (обе роли).
- Причина: группы `(customer)` и `(contractor)` прозрачны в URL, expo-router при холодной загрузке выбирает `(contractor)`; `RoleGroupGuard` видел чужую группу и редиректил на `index`, теряя вкладку и query.
- Исправление: 92cd0fb2 — редирект стража открывает ту же вкладку с теми же параметрами в своей группе (`sharedTabSegment`, `carryParams`); тест `lib/roleGroupGuard.test.ts`, e2e `e2e/deep-link-cold-start.spec.ts` (12 кейсов, падал до исправления).

## Открыто
(заполняется по ходу обхода)
