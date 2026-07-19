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
| D1 | `purchase` paid/delivered не создаёт `Expense` | Fact бюджета mobile≠server |
| D2 | Legacy `project_service.accept_stage` | Обход AcceptOrchestrator |
| D3 | Unilateral estimate lock | Нет mutual consent |
| D4 | Auto-approve picks при create purchase | Минует customer approve |
| U1 | Dual accept surfaces (banner vs list «Проверить») | Когнитивный fork |
| U2 | Portal без schedule/estimate/approvals | Guest неполный golden path |
| U3 | CO verbs «Согласовать» vs «Одобрить» | Дубль языка |
| O1 | H0 staging HTTPS + live pay + 3 paid Pro | Доверие инвестора |

---

## Как проверять локально

```bash
cd apps/mobile && npx tsx lib/domain/buildProjectOsSnapshot.w55.test.ts
npx tsx lib/domain/buildHomeKpiDetail.test.ts
```

Демо: customer Home при `schedule.status=submitted` → CTA «Подтвердить график»; complete → Документы.
