# Journey audit → единая логика (2026-07-19)

Аудит путей **заказчик × исполнитель × данные** тремя explore-агентами + волна **W55** (attention / honesty).

Канон: `object → estimate lock → schedule confirm → acceptance → payment → docs → warranty/closeout`.

Canvas: `renova-journey-audit.canvas.tsx` (Cursor canvases).

---

## Вердикт

| Контур | Было | После W55 | Остаток |
|--------|------|-----------|---------|
| Customer attention (Home/inbox) | ~5/10 — пропускал график/смету, «Закупить», warranty→QC | ~8.5/10 | portal gaps, dual accept UI |
| Contractor attention | ~6/10 — нет «ждём приёмку», ложный 402 assign | ~8/10 | notify invoice/selection |
| Data SoT | ~6/10 | без изменений в W55 | Purchase→Expense, legacy accept_stage |

**Пилот/инвестор** по-прежнему блокирует **H0 ops** (HTTPS staging + live YuKassa + TestFlight), не недостаток экранов.

---

## W55 — что сделано

1. **nextAction priority** — оплата → приёмка → график `submitted` → смета unlock → просрочка → материалы (роль) → dash.
2. **Honest unpaid** — только `Payment.pending`, без proxy `done && !accepted`.
3. **Role materials** — заказчик «Согласовать», исполнитель «Закупить».
4. **Complete hero** → `/documents` (closeout/warranty), не только `/reports`.
5. **Inbox** — schedule confirm / estimate lock (customer); await acceptance / schedule waiting (contractor).
6. **Setup checklist** — смета «готово» только после `estimate_locked_at`.
7. **Warranty** — customer → `/documents`; contractor → QC; activity/notify role-aware.
8. **Portal `payments_mode`** — `live | requisites | demo | off`; кнопка карты только live/demo.
9. **Assign** — 404 / 409 already_assigned / 402 Pro (не всё под paywall).

Файлы: `buildProjectOsSnapshot.ts`, `OsHomeScreen.tsx`, `buildInboxItems.ts`, `buildSetupChecklist.ts`, `DocumentsHub.tsx`, `routeRegistry.ts`, `resolveCatchAllSlug.ts`, `buildHomeKpiDetail.ts`, `HomeCompletionStrip.tsx`, `portal.py`, `portal.tsx`, `projects.py`, `export.py`.

Тест: `apps/mobile/lib/domain/buildProjectOsSnapshot.w55.test.ts`.

---

## Backlog (честно, ≥9/10)

| ID | Проблема | Почему важно |
|----|----------|--------------|
| D1 | ~~Purchase→Expense~~ | **закрыто W56** |
| D2 | ~~legacy accept_stage~~ | **закрыто W56** (410 / RuntimeError) |
| D3 | ~~Unilateral estimate lock~~ | **закрыто W57** |
| D4 | ~~Auto-approve picks~~ | **закрыто W57** |
| U1 | ~~Dual accept surfaces~~ | **закрыто W57/W58** |
| U2 | ~~Portal schedule/estimate~~ | **закрыто W57** |
| U3 | ~~CO verbs~~ | **закрыто W58** |
| P1 | Portal pay без scope `pay` | **закрыто W59** |
| P2 | Chat confirm_payment без project_id | **закрыто W59** |
| P3 | Portal schedule confirm без scope | **закрыто W60** |
| P4 | Closeout без акта приёмки | **закрыто W60** |
| P5 | Closeout доступен исполнителю | **закрыто W61** |
| P6 | Warranty close исполнителем снимает closeout-блокер | **закрыто W62** |
| P7 | Issue close до project bind (cross-project) | **закрыто W63** |
| P8 | Lock без propose при contractor | **закрыто W64** |
| P9 | readyPickIds draft→purchase CTA | **закрыто W64** |
| P10 | Customer warranty close тупик | **закрыто W64** |
| P11 | Contractor close issue = финал | **закрыто W64** (→ fixed) |
| O1 | H0 staging HTTPS + live pay + TestFlight | **блокер пилота (ops)** |

---

## Как проверять локально

```bash
cd apps/mobile && npx tsx lib/domain/buildProjectOsSnapshot.w55.test.ts
npx tsx lib/domain/buildHomeKpiDetail.test.ts
```

Демо: customer Home при `schedule.status=submitted` → CTA «Подтвердить график»; complete → Документы.

## Статус волн после аудита (develop)

| Волна | Коммит | Закрыто |
|-------|--------|---------|
| W55 | `982edcd` | nextAction/inbox, warranty, portal mode, assign |
| W56 | `c3e1db9` | D1 Purchase→Expense, D2 legacy accept |
| W57 | `b4da976` | D3 mutual lock, D4 picks gate, U1/U2 portal schedule |
| W58 | `ea76b40` | U3 verbs, control→repair hub |
| W59 | `41cec44` | portal `pay` scope + chat confirm project bind |
| W60 | `93920c3` | schedule scope + closeout docs gate |
| W61 | `0211060` | closeout customer-only |
| W62 | `fc34d7c` | warranty close customer-only |
| W63 | `52a3935` | issue close project bind before mutate |
| W64 | *(этот коммит)* | mutual propose gate, picks, warranty UX, issue fixed |

**Остаётся блокером пилота:** O1 H0 ops (HTTPS staging + live YuKassa + TestFlight).

## Повторный аудит 2026-07-20

Три агента (customer / contractor / data) после W55–W63. Backend SoT в целом ~8.4/10.
P0 mobile/control закрыты в **W64**. Открыто: H0 ops; P1 reject proposal / portal reject UI / contractor invoice inbox.
