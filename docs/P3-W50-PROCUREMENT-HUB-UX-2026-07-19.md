# P3-W50 — Procurement hub UX (2026-07-19)

## Зачем (P2.4)

Инвестор/пилот видит снабжение как **одну цепочку**, не три вкладки без смысла:  
потребность → закупка → чек → факт бюджета.

## Сделано

1. `procurementNextAction` — один CTA «Сейчас» на экране Материалы.
2. Создание закупки из **approved** (иначе draft/pending), без дублей уже в открытых закупках.
3. Чеки: явная кнопка скана QR.
4. Подбор → Материалы после согласования + CTA исполнителю.
5. Pipeline подпись в списке закупок.
6. Demo seed: потребности (+ черновик закупки) из сметы.
7. Registry: entryPoints materials-procurement.

## Проверка

```bash
cd apps/mobile && npx tsx lib/domain/procurementNextAction.test.ts
```

## Не в волне

AI digest (P2.5), live FNS verify — отдельно.
