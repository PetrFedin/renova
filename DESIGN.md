---
version: alpha
name: Renova · Slate Control
description: Формализация существующего канона apps/mobile/constants/Theme.ts. Спокойный slate/blue интерфейс контроля ремонта. Источник истины - Theme.ts; при расхождении прав Theme.ts.
mode: light-first
source_of_truth:
  - apps/mobile/constants/Theme.ts
  - apps/mobile/constants/typography.ts
  - apps/mobile/constants/uiTokens.ts
  - apps/mobile/constants/screenLayout.ts
  - .cursor/rules/renova-design-system.mdc

colors:
  primary: "#334155"
  primaryPressed: "#1E293B"
  primaryMuted: "#64748B"
  accent: "#2563EB"
  accentMuted: "#DBEAFE"
  background: "#F8FAFC"
  surface: "#FFFFFF"
  surfaceMuted: "#F1F5F9"
  text: "#0F172A"
  textMuted: "#64748B"
  textSubtle: "#94A3B8"
  inverseText: "#FFFFFF"
  border: "#E2E8F0"
  borderLight: "#F1F5F9"
  success: "#15803D"
  successBg: "#F0FDF4"
  successBorder: "#BBF7D0"
  warning: "#B45309"
  warningBg: "#FFFBEB"
  warningBorder: "#FDE68A"
  danger: "#B91C1C"
  dangerBg: "#FEF2F2"
  dangerBorder: "#FECACA"
  info: "#1D4ED8"
  infoBg: "#EFF6FF"
  infoBorder: "#BFDBFE"
  neutralBg: "#F8FAFC"
  neutralBorder: "#E2E8F0"
  neutralText: "#475569"
  tabActive: "#1E293B"
  tabInactive: "#94A3B8"

typography:
  family: "системный шрифт платформы (SF Pro на iOS, Roboto на Android); fontFamily в токенах не задан"
  fontSize: { display: 32, hero: 24, h1: 22, h2: 18, h3: 16, body: 14, bodySmall: 13, caption: 12, tiny: 11, tab: 10 }
  fontWeight: { regular: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800 }
  lineHeight: { body: 20, bodySmall: 18, caption: 16, tiny: 14, metric: 28 }

rounded:
  xs: 6px
  sm: 8px
  md: 10px
  lg: 12px
  xl: 16px
  pill: 999px
spacing:
  xxs: 2px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 20px
  xxl: 24px
  xxxl: 32px
minTouch: 44
shadow: { card: "0px 2px 8px rgba(0,0,0,0.04)" }

proposed:   # НЕ канон. Появится только после правки Theme.ts через PR.
  colors:
    borderStrong: "около #94A3B8, подобрать так, чтобы контраст к surface был не ниже 3.0"
    textMutedStrong: "тёмнее #64748B, для текста на surfaceMuted и accentMuted"
  typography:
    numeric: "fontVariant tabular-nums для денег и таблиц"
---

# Renova · Slate Control

## 1. Visual Theme & Atmosphere

Renova это спокойный сланцево-синий продукт про контроль ремонта: деньги, сроки, приёмка. Интерфейс плоский, текстовый, с тонкими линиями. Не перерисовывать «красиво», а следовать токенам и `components/ui` (канон `renova-design-system.mdc`).

Принципы:
- Один смысл на экран, детали по запросу.
- Одна главная кнопка на экран.
- Цифры денег видимы и честны: состояния загрузки, ошибки, пусто и «устарело» показываются явно, ошибка не маскируется под пустой список.
- Текст пользователю без разработческих слов (`:8100`, `EXPO_PUBLIC_*`, `offline_queued`).
- Светлая тема. Тёмной палитры в `Theme.ts` нет; не вводить локальных тёмных цветов (см. раздел 7).

## 2. Color Palette & Roles

| Токен | Hex | Роль |
|---|---|---|
| background | #F8FAFC | фон экрана |
| surface | #FFFFFF | карточки, поля, нижняя панель |
| surfaceMuted | #F1F5F9 | вторичные поверхности, `secondary` кнопка |
| border / borderLight | #E2E8F0 / #F1F5F9 | линии карточек и разделители |
| text | #0F172A | основной текст |
| textMuted | #64748B | подписи, вторичный текст |
| textSubtle | #94A3B8 | необязательные подсказки (не для функционального текста) |
| primary / primaryPressed | #334155 / #1E293B | главная кнопка (Сохранить, Принять, Оплатить) |
| inverseText | #FFFFFF | текст на primary, accent, danger |
| accent / accentMuted | #2563EB / #DBEAFE | ссылки, активная вкладка, кнопка `accent` |
| success / warning / danger / info | #15803D / #B45309 / #B91C1C / #1D4ED8 | статусы; у каждого `*Bg`, `*Border`, `*Text` |
| neutralBg / neutralBorder / neutralText | #F8FAFC / #E2E8F0 / #475569 | нейтральный статус |
| tabActive / tabInactive | #1E293B / #94A3B8 | нижняя панель |

Роли по канону: primary для главной кнопки, outline для второстепенных, danger для удаления/отклонения/критичного перерасхода, warning для риска и просрочки, accent для ссылок и активной вкладки, `infoBg`/`infoBorder` для активного chip и информационных блоков.

Измеренные контрасты (WCAG, 2026-10-15) - ключевые пары:

| Пара | Контраст | Вывод |
|---|---|---|
| text / background | 17.06 | ок |
| textMuted / surface | 4.76 | ок, малый запас |
| textMuted / surfaceMuted | 4.34 | ниже 4.5, не использовать для мелкого текста |
| textSubtle / surface | 2.56 | не для текста |
| tabInactive / surface | 2.56 | ниже 3.0 для иконок: предложение улучшить |
| inverseText / primary | 10.35 | ок |
| inverseText / accent | 5.17 | ок |
| infoText, successText, warningText, dangerText на своих Bg | 6.16 / 4.79 / 4.84 / 5.91 | ок |
| border / surface | 1.23 | допустимо для декоративной линии карточки; недостаточно как граница поля ввода |

Правило: цвет не единственный носитель смысла; рядом слово или иконка (`StatusPill` содержит текст).

Как проверять все пары: см. `docs/business/03-design-and-ui-analysis.md` раздел 8 (скрипт на основе `RenovaTheme.colors`, матрица текст × поверхность, порог 4.5 для текста и 3.0 для крупного текста и нетекстовых элементов, список исключений с причиной).

## 3. Typography Rules

Шрифт: системный (в токенах `fontFamily` не задан). Не добавлять новых шрифтов без решения владельца и правки `typography.ts`.

| Стиль | Размер/вес | Применение |
|---|---|---|
| display | 32 / 800, letterSpacing -0.5 | крупные KPI |
| hero | 24 / 700 | значения денег в sheet |
| h1 | 22 / 700, letterSpacing -0.3 | заголовок экрана (один) |
| h2 | 18 / 800 | секция |
| h3 | 16 / 600 | подзаголовок |
| body, bodySemibold | 14 / 400, 600, lineHeight 20 | текст |
| bodySmall | 13 / 400, lineHeight 18, textMuted | вторичный |
| caption, captionBold | 12 / 500, 700, lineHeight 16 | подписи |
| tiny | 11 / 600, lineHeight 14 | служебный (предпочтительно не мельче 11) |
| link | 12 / 600, accent | ссылка |
| metric | 24 / 700, lineHeight 28 | деньги и KPI |

Правила:
- Один h1 на экран; sentence case, без крика заглавными (`screenTypography.section`).
- Размеры брать из `typography.ts`/`screenTypography.ts`/`formTypography.ts`; литерал `fontSize` на экране считается отступлением.
- Деньги: `formatRub` из `Theme.ts` (рубли без копеек). Предложение: табличные цифры (`tabular-nums`) для столбцов сумм, через токен в `typography.ts`.
- Не отключать масштабирование шрифта; плотные строки проверять при крупном шрифте.
- Предложение (не канон): не использовать 9-10 px для функционального текста.

## 4. Component Stylings

Базовые компоненты: `components/ui/*` (Card, StatusPill, SectionHeader, InfoBanner, TextLink, LoadingState, EmptyActionState, LoadErrorState) и `components/renova/PrimaryButton.tsx`.

- **PrimaryButton**: варианты `primary | accent | secondary | outline | ghost | danger | dangerOutline`; размеры `sm | md | lg`; `fullWidth`; `loading` и `disabled` блокируют нажатие; `minHeight 44`; радиус `md` (10); haptic; роль `button`, состояния `disabled` и `busy`. Disabled: `opacity 0.45`. Pressed: `opacity 0.85`. Стрелки в тексте (`→ Бюджет`) заменять `TextLink` или `rightIcon`. Не больше одного primary CTA на экран.
- **Card** (`base | action | info | warning | danger | success | metric`): padding 12-14, radius 12, border 1, фон surface; `action` минимум 64 по высоте; нажатая карточка `opacity 0.88`.
- **StatusPill**: тоны `neutral | info | success | warning | danger`; pill (радиус 999), border 1, текст `tiny` bold, минимум 24 по высоте. Статусы только через него.
- **Поле ввода** (`uiTokens.inputField`): `minHeight 44`, radius `md`, border 1 `border`, фон surface, горизонтальный отступ 12, текст 14.
- **Chip** (`chipBase`, `chipActive`): pill, активный chip: фон `infoBg`, граница `accent`.
- **Информационные поверхности** (`info/warning/danger/successSurface`): фон `*Bg`, граница `*Border`, радиус 12.
- **Иконки**: `Ionicons`. Никаких emoji в рабочем UI.
- **FAB заказчика**: канон проекта: Расход · Сообщение · Замечание · Фото, без «Черновик». В коде сейчас иначе (у заказчика «Расход» и «Сообщение», у исполнителя ещё «Работа» и «В черновик»): расхождение описано в `docs/business/04-interface-and-connections.md`; при расхождении права код и решение владельца.
- **Состояния данных**: загрузка (`LoadingState`), ошибка с «Повторить» (`LoadErrorState`), пусто с действием (`EmptyActionState`), устаревшее (баннер), офлайн (баннер). У каждого списка и формы они обязательны.

Предложения (не канон, требуют PR в `Theme.ts` и `components/ui`):
- Перенести `PrimaryButton` в `components/ui` с реэкспортом из прежнего пути.
- Добавить видимый focus для web/клавиатуры.
- Граница поля `borderStrong` (контраст не ниже 3.0 к фону).

## 5. Layout Principles

- Сетка 4/8: 2, 4, 8, 12, 16, 20, 24, 32.
- Экран: padding 16; между блоками 16; между карточками 8-12; нижний отступ 32; для экранов вкладок нижний запас под FAB (`FAB_SAFE_BOTTOM`, `screenLayout.tabContentStyle`).
- Радиусы: xs 6, sm 8, md 10, lg 12 (карточки), xl 16, pill 999.
- Навигация (канон `routeRegistry.ts`): Dock из Главной, Сообщений, Объекта, Ремонта, Бюджета/Денег; «Сроки» как hub; приёмка через Ремонт; финансы через Бюджет; уведомления через `/inbox`. Не больше 4 вкладок hub без фильтра или «Ещё».
- Широкие экраны (web/планшет): кнопки не растягиваются на всю ширину (`maxWidth 360/440` в `PrimaryButton`), списки комнат и платежи адаптируются в сетки/таблицы (e2e `responsive-*`).

## 6. Depth & Elevation

Почти плоско: линии вместо теней. Единственный токен тени `shadow.card` (`0 2px 8px rgba(0,0,0,0.04)`, `elevation 1`) и `shadow.none`. Не более двух уровней тени; шапка и нижняя панель без тени (линия 1px `border`). Нажатие передаётся прозрачностью, не тенью.

## 7. Do's and Don'ts

Можно:
- Только `RenovaTheme.colors.*` и `uiTokens`.
- `Card`, `PrimaryButton`, `StatusPill`, `SectionHeader`, `TextLink`.
- Один primary CTA на экран.
- Явные loading, empty, error, stale.
- Цели касания не меньше 44 pt, метки `accessibilityLabel` на иконках и опасных действиях.
- Изменять внешний вид только правкой токенов в `Theme.ts`/`uiTokens.ts`/`typography.ts` и компонентов `components/ui`.

Нельзя:
- Локальные hex (`#EFF6FF`, `#eee`, `#f0f0f0`) в компонентах.
- Emoji в операционном UI.
- Dev-тексты в пользовательском UI.
- Свои `StyleSheet`-карточки и кнопки на экранах.
- Больше одного primary CTA на экран.
- Тёмные цвета, придуманные на месте. Тёмная тема: либо фиксируется светлая (`userInterfaceStyle`), либо вводится палитра в `Theme.ts` по решению владельца.
- Использовать `textSubtle` и `tabInactive` для функционального текста; `textMuted` на `surfaceMuted`/`accentMuted` для мелкого текста.
- Отключать масштабирование шрифта.

## 8. Responsive Behavior

- iPhone-first: safe area, нижняя панель, FAB заказчика.
- Минимальная зона касания 44 pt (`RenovaTheme.minTouch`).
- Web/планшет (ширина от 768): ограничение ширины кнопок, сетки комнат, таблица платежей, KPI-плотность; контролируются e2e `responsive-*`.
- Динамический размер текста: не ограничивать глобально; для плотных строк задавать предел через токен (предложение).
- Движение сдержанное: нажатие это прозрачность; уважать «уменьшение движения» платформы (проверить, не подтверждено).
- Тёмная тема: не поддерживается токенами (см. раздел 7).

## 9. Agent Prompt Guide

Перед работой прочитать `AGENTS.md`, `.cursor/rules/renova-design-system.mdc`, `apps/mobile/constants/Theme.ts`.

Промпт-заготовка:
> Меняешь UI Renova. Используй только `RenovaTheme` и `components/ui`. Не вводи hex, emoji, собственные карточки и кнопки. Один primary CTA на экран. Покажи состояния loading, empty, error, stale. Зоны касания не меньше 44. Деньги через `formatRub` и стили `metric`. Если нужен новый цвет или размер, предложи правку `Theme.ts`/`typography.ts`, а не локальное значение.

Проверка перед сдачей:
1. `grep` нового кода на `#[0-9A-Fa-f]{3,6}` и emoji: ноль.
2. Контрастные пары из раздела 2 не ухудшены; новые пары проверены.
3. `npm run typecheck:mobile` и релевантные e2e `responsive-*` зелёные (запускает владелец/CI, не агент без разрешения).
4. Если изменён экранный контракт: синхронизировать `docs/technical-spec/SCREEN-CONTRACT-CATALOG.md` (AGENTS.md §1).

Статус файла: формализация, не источник истины. При расхождении с `Theme.ts` прав `Theme.ts`.

## Что осталось неподтверждённым

- Внешний вид на устройстве: файл собран из кода токенов, экраны не запускались.
- Поведение Reduce Motion и тёмной темы на устройстве.
- Подбор значений `borderStrong` и `textMutedStrong`: только после расчёта контраста и правки `Theme.ts`.
- Применимость формата Stitch DESIGN.md: структура взята из `~/.claude/design/styles/our/renova-slate-control/DESIGN.md`, внешняя спецификация формата не сверялась.
