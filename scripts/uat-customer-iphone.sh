#!/usr/bin/env bash
# P0.1 — живой UAT путь заказчика: API preflight + iPhone preview + чеклист 15 сценариев
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API="${RENOVA_API:-http://127.0.0.1:8100}"

echo "=== Renova P0.1 — UAT заказчик (iPhone preview) ==="
echo ""

echo "▶ Шаг 0: API-регресс (15 сценариев)..."
if curl -sf "${API}/health" >/dev/null 2>&1 || curl -sf "${API}/api/v1/auth/demo" -X POST -H 'Content-Type: application/json' -d '{"role":"customer"}' >/dev/null 2>&1; then
  cd "${ROOT}"
  if npx playwright test e2e/customer-path.spec.ts --reporter=line; then
    echo "✓ API preflight: 15/15"
  else
    echo "✗ API preflight упал — почините backend перед UI-прогоном"
    exit 1
  fi
else
  echo "⚠ Backend недоступен (${API}). Запустите: npm run dev"
  echo "  Продолжаю только UI-чеклист без API preflight."
fi
echo ""

echo "▶ Открываю iPhone preview..."
bash "${ROOT}/scripts/open-iphone-preview.sh" || true
echo ""

cat <<'EOF'
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
РУЧНОЙ ПРОГОН (iPhone preview / Expo)
Роль: Заказчик · объект: «Демо-квартира»
Критерий: 0 блокеров на demo-path
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 1. Вход          Demo → Заказчик → «Демо-квартира»
 2. Главная       Checklist + баннер приёмки
 3. Объект        Смета: Итог · Изменения · Детализация · Документы
 4. Wizard        Быстро (< 2 мин) — опционально новый объект
 5. Post-create   Sheet «Что дальше?» после confirm
 6. Invite        Пригласить исполнителя (checklist / профиль)
 7. Ремонт        Фильтры: Сейчас | Ждёт меня | Проблемы | Все
 8. Приёмка       «Проверить» → stage detail (accept above fold)
 9. Оплата        Блок без приёмки → CTA; чек → confirm
10. Чек↔счёт     scan-receipt с paymentId → receipt_id в оплате
11. Чат           Unread; auto-chat по этапу
12. Черновик      Tap → edit
13. Календарь     Badge, done/extend; план read-only отдельно
14. Hub web       Нет дубля Hero/KPI (OsTabFocusGate)
15. Тупики        Сброс фильтра; без :8100 / offline_queued в UI

API: npx playwright test e2e/customer-path.spec.ts
Preview: npm run preview
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
