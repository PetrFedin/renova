#!/usr/bin/env bash
# Renova — 5-мин demo (API smoke + подсказки UI)
set -euo pipefail
API="${API:-http://127.0.0.1:8100}"
echo "=== Renova Demo 5 min ==="
bash "$(dirname "$0")/e2e-smoke.sh"
echo ""
echo "UI сценарий:"
echo "1. onboarding/role → Заказчик (demo)"
echo "2. Главная → прогресс, внимание, switcher"
echo "3. Этапы → stage → чеклист → Принять"
echo "4. Ещё → Финансы → оплата + скан QR"
echo "5. Комнаты → матрица этап×комната"
echo "6. ProjectSwitcher → Демо-дом (этажи)
7. Финансы → CSV расходов
8. Профиль → добавить наблюдателя +70000000003"
echo "9. Смена роли → Исполнитель → смета → заявки"
echo "10. onboarding → Наблюдатель → read-only баннер"
