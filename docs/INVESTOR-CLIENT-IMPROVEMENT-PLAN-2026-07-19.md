# Renova — план улучшений для инвесторов и клиентов (2026-07-19)

**Канон:** `renova/` → GitHub `PetrFedin/renova` (`develop`)  
**Основание:** `RENOVA-COMPETITIVE-GAP-PLAN`, `P3-W43-journey-audit-fixes`, `MVP-SPEC-RU`, `MARKET-COMPETITIVE-AUDIT`, агентский разбор journey  
**Цель:** продукт, которым **пользуются без няньки**, а инвестор за 15 минут видит **денежный контур ремонта**, не демо-заглушки.

---

## 0. North star (одна фраза)

> Renova — операционная система ремонта квартиры: **смета → сроки → приёмка → оплата → документы → гарантия**, где каждое действие меняет цифры, владельца и следующий шаг.

**Для инвестора:** unit economics подписки исполнителя + вирусность через portal заказчика.  
**Для клиента (заказчик):** спокойствие «сколько потратил / что принято / что подписать».  
**Для клиента (исполнитель):** меньше хаоса WhatsApp, легальные чеки, быстрый cashflow по этапам.

---

## 1. Полный путь ролей (целевой, без тупиков)

### 1.1 Заказчик (бесплатно)

| Шаг | Действие | Экран | Данные / контроль | Финал шага |
|-----|----------|-------|-------------------|------------|
| 0 | Онбординг роли | `/onboarding/*` | role=customer | → Home |
| 1 | Объект / комнаты | Object hub | rooms → площади | черновик объекта |
| 2 | Смета v1 | Object / estimate | calc-engine + lines | draft estimate |
| 3 | **Lock / согласование сметы** | Approvals / Object | version freeze + notify | **базовая смета locked** |
| 4 | График этапов | Сроки | work_schedule SoT | даты на календаре |
| 5 | Ожидание работ | Home next-action | badges | inbox |
| 6 | Приёмка этапа | Repair → Приёмка | work-acceptances | accepted / return |
| 7 | Подпись акта | Документы | in_app / Kontur → **active** | signed act |
| 8 | Оплата | Бюджет → sheet | gate: только после accept | paid + notify |
| 9 | Change order | Approvals | CO → budget delta + act | plan обновлён |
| 10 | Гарантия / closeout | Документы + Приёмка | warranty ticket | closed / archived |

### 1.2 Исполнитель (подписка)

| Шаг | Действие | Экран | Данные / контроль | Финал |
|-----|----------|-------|-------------------|-------|
| 0 | Онбординг + Pro | subscription | YuKassa live | active Pro |
| 1 | Создать / принять объект | Home / Objects | membership | active project |
| 2 | Смета из шаблона | Estimate | catalog + calc | draft → send approve |
| 3 | Реквизиты / ФНС | Profile | payment_requisites, NPD check | trust ready |
| 4 | Запуск этапа | Repair | stage in_progress + calendar | visible dates |
| 5 | Запрос приёмки | Repair → Приёмка | WA submit + notify | pending customer |
| 6 | Выставить счёт | Бюджет | **только stage/material** | pending pay |
| 7 | Снабжение | Selections / purchases | pick→purchase→receipt | plan-fact materials |
| 8 | Замечания QC | QC / Приёмка | issues + photo | closed |
| 9 | Отчёты / 1С | Documents | XML/CSV export | бухгалтерия |
| 10 | Рейтинг | Profile | сроки+бюджет+чеки | score |

### 1.3 Заказчик без приложения (Portal)

| Шаг | Сейчас | Target |
|-----|--------|--------|
| Magic link snapshot | ✅ read-only | ✅ |
| Accept stage | ❌ / partial | ✅ = тот же WA orchestrator |
| Sign act | ❌ / in_app only app | ✅ |
| Pay pending | ❌ | ✅ YuKassa return |
| Branding | weak | logo + project name |

---

## 2. Приоритеты по ценности (не по «интересности кода»)

Шкала: **I** = инвестор на демо, **C** = платящий пилот, **O** = ops/retention.

### P0 — «Нельзя показывать / нельзя отдавать пилоту» (2 недели) — H0

| # | Что | Зачем I/C | Effort | Метрика успеха | Волна |
|---|-----|-----------|--------|----------------|-------|
| P0.1 | **Единый accept orchestrator** (WA = schedule = portal) | Нет разных side effects на демо | M | 1 code path; e2e 3 входа → одинаковый act+notify+event | W44 |
| P0.2 | **YuKassa staging live** (не demo) + return deep link | Инвестор видит реальные деньги | M | 1 test payment confirm idempotent | W44 |
| P0.3 | **Portal v2: accept + pay** | Заказчик без TestFlight | L | magic link → accept → pay E2E | W45 |
| P0.4 | **Lock base estimate** + approvals в More | Нет «согласованной» сметы = нет договора | M | customer lock → version frozen | W44 |
| P0.5 | **Honesty mode staging** | Нет ложных «чат/ФНС/Kontur» | S | все CTA либо работают, либо hidden | W44 |
| P0.6 | Demo script seed + checklist | 15 мин без импровизации | S | `scripts/demo-seed` + TESTFLIGHT checklist PASS | W44 |

### P1 — «Можно продавать пилоты» (6 недель) — H1

| # | Что | Зачем | Effort | Метрика | Волна |
|---|-----|-------|--------|---------|-------|
| P1.1 | CO → budget line + signable act | Изменения сметы = деньги | M | approve CO → plan-fact + doc | W45 |
| P1.2 | Bank CSV → **confirm** payment | Бухгалтерия закрывает цикл | M | match + apply → paid | W45 |
| P1.3 | Единый `budget_planned` writer / BFF summary | Цифры не врут на демо | M | 1 endpoint budget-summary | W45 |
| P1.4 | Work schedule UI submit/confirm | Сроки не «только API» | M | contractor submit → customer confirm | W46 |
| P1.5 | Subscription Pro без demo-bypass в staging | Монетизация честная | S | paywall → webhook → Pro | W46 |
| P1.6 | Home next-action queue (1 список) | «Что делать сейчас» | M | ≤3 prioritized todos | W46 |
| P1.7 | Punch photo on plan + offline badge | Полевой вау | M | issue+photo from plan | W46 |
| P1.8 | Onboarding ≤5 экранов + sample project | Time-to-value <10 мин | M | activation funnel | W46 |

### P2 — «Защищаемый продукт / moat» (квартал) — H2

| # | Что | Зачем | Effort | Метрика | Волна |
|---|-----|-------|--------|---------|-------|
| P2.1 | Kontur sandbox E2E стабильный | Trust vs Smetter | L | sign→webhook→active 100% | W47 |
| P2.2 | FNS receipt verify live honesty | Легальность = рейтинг | M | staging verify PASS | W47 |
| P2.3 | 1C CommerceML/XML export prod-ready | B2B закуп | M | export payments+acts | W47 |
| P2.4 | Procurement hub UX (снабжение) | RU parity Vition | M | pick→purchase→receipt UI | W48 |
| P2.5 | AI weekly digest (Ollama) | Retention | M | push RU summary weekly | W48 |
| P2.6 | Warranty close → archive doc | Post-sale | S | close → archived | W48 |
| P2.7 | IA dedup: 1 Сроки, registry≈screens | Нет «двух продуктов» | M | routes ≤40 user-facing | W48 |

### P3 — «Масштаб» (6 месяцев) — H3

| # | Что | Зачем | Effort | Метрика |
|---|-----|-------|--------|---------|
| P3.1 | Team / multi-user contractor | бригады | L | invite + ACL |
| P3.2 | Marketplace lead → project | рост | M | 1-click convert |
| P3.3 | Stripe / intl (после RU PMF) | expansion | L | second rail |
| P3.4 | Multi-org enterprise ACL | B2B сети | L | orgs |
| P3.5 | TestFlight → App Store | дистрибуция | L | public listing |

---

## 3. Что уже сильно (не ломать — показывать)

1. **Calc-engine + смета** — ядро ценности.  
2. **Payment gate по приёмке** — правильная бизнес-логика.  
3. **Document Center + eSign poll** (W41–W42).  
4. **Portal magic link snapshot** (база для v2).  
5. **4-hub IA** (Home / Object / Repair / Budget) — ближе к RU «карточка объекта».  
6. **W43:** ControlView приёмки, AcceptancePassed, in_app → active, payment types, warranty paths.

---

## 4. Скрипт демо инвестору (15 мин) — target после P0

| Мин | Сцена | Must work |
|-----|-------|-----------|
| 0–2 | Проблема: WhatsApp + Excel | слайд / 1 экран Home |
| 2–5 | Исполнитель: смета из шаблона → lock | цифры живые |
| 5–8 | Запрос приёмки → заказчик accept → акт | один UX |
| 8–11 | Оплата YuKassa test / SBP | webhook confirm |
| 11–13 | Portal ссылка заказчику | accept или pay без app |
| 13–15 | Документы + «что дальше» на Home | next action |

**Сейчас ломает демо (честно):** portal без action; местами demo pay; нет явного lock сметы; bank import без confirm; тройной accept path (частично закрыто W43).

---

## 5. Критерии «готово для пилота» (Definition of Pilot)

- [ ] Seed-проект проходит golden path без ручного SQL  
- [ ] Заказчик и исполнитель не видят 403/501 на видимых кнопках  
- [ ] Оплата: staging live ИЛИ честный «подтвердить перевод» без лжи про чат  
- [ ] Portal: хотя бы accept ИЛИ pay  
- [ ] Смета: версия locked после согласования  
- [ ] Уведомления на accept / pay / CO  
- [ ] Checklist `TESTFLIGHT` зелёный  
- [ ] Один budget-summary без расхождения цифр  

---

## 6. Порядок исполнения (рекомендация команде)

```
W44  P0.1 orchestrator + P0.4 lock estimate + P0.5 honesty + P0.6 demo seed
W45  P0.2 YuKassa live + P0.3 portal accept/pay + P1.1 CO→budget + P1.2 bank confirm
W46  P1.3 budget BFF + P1.4 schedule UI + P1.5–P1.8 sellable polish
W47  P2.1–P2.3 trust/RU integrations
W48  P2.4–P2.7 moat UX + retention
```

**Не делать сейчас:** BIM/RFI, второй acceptance API, Stripe до RU PMF, AI-чат на каждом экране, marketplace = project chat.

---

## 7. Связь документов

| Док | Роль |
|-----|------|
| Этот файл | **приоритет для инвесторов/клиентов** |
| `RENOVA-COMPETITIVE-GAP-PLAN` | инженерный backlog P3–P5 |
| `P3-W43-journey-audit-fixes` | закрытые тупики journey |
| `DEAD-ENDS-INVENTORY` | трекер stub/dead ends |
| Canvas `renova-investor-roadmap` | визуальная матрица |


---

## 8. Productization (агент GTM) — дополнение

**Монетизация сейчас:** заказчик free · исполнитель Pro **990 ₽/мес** · free = **1 объект**.  
**Web:** Expo `mobile:web` + `/portal` (отдельного `apps/web-client` нет).

### H0 дополнения (обязательно к §2 P0)

| ID | Item | Success metric |
|----|------|----------------|
| H0.1 | Staging API + TestFlight HTTPS (не localhost) | ≥5 внешних тестеров → API 200 |
| H0.3 | Portal без hardcoded реквизитов | 0 hardcode карт в `portal.tsx` |
| H0.7 | CI green на develop | `merge:check` + CI на последнем push |

### H1 дополнения

| ID | Item | Success metric |
|----|------|----------------|
| H1.1 | Trial 14д + paywall copy | ≥15% free→Pro trial / 30д |
| H1.5 | Team QR + роли field | ≥1 пилот с 2+ членами |
| H1.8 | 3 paid pilots + MRR > 0 | договор + оплата |
| H1.9 | E2E portal pay/sign + sub webhook | green в CI |

### Критический путь

```
staging/TF → live YuKassa → portal requisites
           ↘ Pro UX → paid pilots
YuKassa+requisites → portal v2 → CO chain
eSign → FNS + 1C (trust stack)
CI → E2E expansion → безопасный H2
```

### Fundraising hooks

1. Problem: Excel / Telegram / банк / фото.  
2. Solution: dual-role OS + portal + gate приёмка→оплата.  
3. Traction: H0 trust → H1 MRR → H2 RU moat (НПД/ФНС/1С).  
4. Moat: calc-engine + Document Center + digital passport.  
5. Use of funds: acquiring+eSign (H0–H1), затем 1C/FNS/offline (H2).


---

## 9. Сводка трёх агентов (2026-07-19)

| Агент | Фокус | Главный вывод |
|-------|-------|---------------|
| Demo / investor | 15 мин демо + week-1 | Ядро accept→pay→docs живо; ломают demo-оплаты, portal demo-реквизиты, IA-дубли, нет lock сметы у customer |
| Data / actions | SoT цепочки | Три писателя приёмки + dual `budget_planned` + schedule/bank/warranty API без UI; первый epic = AcceptOrchestrator |
| GTM / productization | H0–H3 | Продаётся после staging HTTPS + live YuKassa + portal без hardcode + Pro без demo-bypass; MRR через 3 paid pilots |

**Единый порядок исполнения (согласован всеми):**  
W44 AcceptOrchestrator (+ stage_id в events) → W45 Budget SoT + YuKassa/portal honesty → W46 Schedule confirm UI → W47 Bank→confirm pay → W48 Warranty close + closeout · параллельно H0 staging/TestFlight.

---

## 10. Быстрые «wow» для демо (из demo-агента)

Параллельно W44, низкий effort:

1. YuKassa staging keys + 1 real pay  
2. Seed: реквизиты/СБП у contractor  
3. Один CTA на Home для demo-профиля  
4. Demo script mode: скрыть beta/«Ещё»  
5. Pre-seed pending acceptance + payment  
6. Badge интеграций: ФНС / ЮKassa / Kontur status  
7. Крупный contract-gate badge после in_app sign  
8. Показать weekly digest / паспорт объекта из Document Center  

Ведущему демо: деньги = confirm + clipboard; карту — только с keys.

---

## 11. Статус исполнения (2026-07-19)

| Волна | Статус |
|-------|--------|
| W44 AcceptOrchestrator | ✅ |
| W45 Budget SoT + bank confirm | ✅ |
| W45 YuKassa live keys | ⏳ ops |
| W46 Schedule UI + Home polish | 📋 next |
