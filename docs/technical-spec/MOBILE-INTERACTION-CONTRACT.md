# Renova — mobile interaction contract

**Статус:** ACTIVE / governed annex  
**Область:** customer/contractor mobile UI  
**Подчинение:** `AGENTS.md`, `docs/technical-spec/PRODUCT-COMPLETION-MANDATE.md`, current route/data/domain contracts  
**Назначение:** единый контракт принятия UI-решений без создания второго design system и без расширения product scope.

## 1. Базовый принцип

Renova оптимизирует не декоративную эффектность, а предсказуемость, скорость и правдивость интерфейса. Visual polish допустим только после корректности состояния и действия.

Верхний invariant:

`correctness before delight`.

Пользователь должен понимать:

1. что произошло;
2. подтверждён ли authoritative commit;
3. какие данные актуальны, устарели или недоступны;
4. что можно безопасно повторить;
5. кто и что должен сделать дальше.

## 2. Источники истины

- navigation: `apps/mobile/lib/routeRegistry.ts` + текущая Expo route composition;
- colors/spacing/radius/touch geometry: `apps/mobile/constants/Theme.ts`;
- typography: `apps/mobile/constants/typography.ts`, `screenTypography.ts`;
- semantic surfaces: `apps/mobile/constants/uiTokens.ts`;
- shared UI primitives: `apps/mobile/components/ui/*` и существующие canonical Renova components;
- async read truth: `apps/mobile/lib/async/asyncResource.ts`;
- safe UI error taxonomy: `apps/mobile/lib/async/appError.ts`.

Этот annex не разрешает создавать параллельные Button/Card/Route/State abstractions там, где canonical primitive уже существует.

## 3. Design Decision Gate

Для нового или изменяемого UI решения:

1. **Purpose.** У элемента должна быть конкретная пользовательская задача.
2. **Frequency.** Чем чаще действие, тем меньше motion и ceremony. Частотные пороги используются как эвристика, а не жёсткая математика.
3. **Action hierarchy.** Одно состояние экрана — не более одного primary CTA.
4. **Press.** Visual feedback начинается при касании и не зависит от ответа API.
5. **Native first.** Platform/native primitive предпочтителен, пока он не ломает product contract, web parity или accessibility.
6. **Motion purpose.** Допустимые причины: feedback, state indication, spatial continuity, gesture, предотвращение резкого визуального скачка.
7. **Gesture.** Finger-driven UI должен быть interruptible и следовать пальцу; gesture не добавляется ради декоративности.
8. **Navigation.** `routeRegistry.ts` остаётся canonical IA. Contextual shortcuts не создают новый top-level domain. Изменение постоянного dock — отдельное product decision.
9. **Haptics.** Selection, commit, destructive commit, success и error имеют разный смысл. Navigation/action не получают haptic автоматически только потому, что они pressable.
10. **Tokens.** Semantic color/radius/status surface не задаются локально при наличии shared token.
11. **Accessibility.** Минимум 44pt, font scaling, accessibility labels/states, contrast. Любой новый motion одновременно получает reduced-motion behavior.
12. **State truth.** Loading, empty, stale/offline, error, read-only/access, conflict и success не взаимозаменяемы.
13. **Prototype gate.** Несколько реально разных UI-направлений сначала сравниваются изолированно; production code не служит макетом.
14. **Verify.** Проверяются tap/hold/rapid repeat, loading, error, offline, stale, conflict/access, success и canonical route.
15. **Exception.** Отклонение имеет записанную продуктовую или техническую причину и bounded evidence.

## 4. State contract

Canonical read lifecycle уже представлен `AsyncResource`:

`idle | loading | refreshing | success | empty | stale | offline | error`.

Правила:

- `empty` допускается только после authoritative successful read;
- initial failure не изображается empty;
- refresh failure при наличии last confirmed data сохраняет данные и помечает их stale/offline;
- stale/offline financial и approval surfaces не должны предлагать unsafe mutation, если action зависит от неизвестного authoritative state;
- read-only/access refusal не маскируется disabled control без объяснения;
- HTTP conflict — отдельный пользовательский смысл: данные изменились, blind retry mutation запрещён до refresh/reconcile;
- post-commit refresh/sync/navigation failure не превращает committed operation в «не сохранено».

Критическая mutation следует product outcome contract:

`committed | queued | unknown_needs_reconcile | authoritative_refusal`.

## 5. Feedback contract

Одно событие имеет один главный user-visible feedback channel. Дополнительный haptic допустим только как сопровождающий сигнал и никогда не является единственным подтверждением.

Примеры:

- press-in: immediate visual feedback;
- API processing: disabled/busy state без competing duplicate mutation;
- committed: authoritative success state/copy;
- queued: явно «будет отправлено после восстановления связи», не «готово»;
- conflict: refresh/reconcile path, не blind repeat;
- access revoked/forbidden: объяснение доступа, не retry loop;
- post-commit refresh failure: «сохранено, не удалось обновить данные» + retry read/reconcile.

## 6. Motion contract

Motion добавляется только при сформулированной цели. Частые tab/filter/navigation действия не получают декоративную анимацию. Finger-driven motion реализуется на UI thread и остаётся interruptible.

При первом системном motion primitive reduced-motion support является частью того же change-set. Отдельное последующее обещание accessibility не считается завершением.

Не требуется менять существующие стабильные экраны только ради добавления движения.

## 7. Navigation stability

Canonical top-level IA определяется `routeRegistry.ts`. Context может менять badges, attention, content и shortcuts. Автоматическое изменение состава/позиции основных dock destinations не расширяется без отдельного product decision/prototype/evidence slice.

User customization, если сохранена продуктом, должна быть явным действием пользователя и не смешиваться с автоматическим contextual rearrangement.

## 8. Enforcement strategy

Enforcement вводится после bounded cleanup соответствующей области, чтобы CI не был заведомо красным на существующем `main`.

Предпочтительные проверки:

- новые raw semantic hex вне token allowlist;
- operational emoji при наличии icon primitive;
- raw developer/runtime strings;
- duplicate top-level hubs / обход canonical route registry;
- regression tests на error/empty/stale/commit-vs-refresh truth.

Новые GitHub workflows только ради этого annex не создаются; проверки подключаются к существующим canonical test/CI paths в рамках действующего mandate.

## 9. Scope discipline

Этот контракт применяется к затронутому UI в bounded task/PR и не является разрешением на массовый редизайн. Не смешивать с ним без отдельной задачи:

- изменение finance/domain source of truth;
- ACL/role semantics;
- массовую замену всех `Pressable`;
- изменение canonical dock;
- массовую migration всех Modal/Sheet;
- новый animation framework;
- глобальную смену palette/typography.

Найденный соседний дефект фиксируется в соответствующем governed issue/roadmap, если он выходит за текущий bounded scope.
