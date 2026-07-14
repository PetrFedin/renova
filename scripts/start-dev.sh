#!/usr/bin/env bash
# Запуск backend + Expo web + iPhone preview по умолчанию
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXPO_PORT="${EXPO_PORT:-8081}"
API_PORT="${API_PORT:-8100}"
PREVIEW_URL="http://127.0.0.1:${EXPO_PORT}/iphone-preview.html"

echo "Останавливаю старые процессы на :${EXPO_PORT} и :${API_PORT}..."
lsof -ti:"${EXPO_PORT}" -ti:"${API_PORT}" 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1

echo "Backend :${API_PORT}..."
cd "${ROOT}/backend"
source .venv/bin/activate
# Form/upload routes require python-multipart (Wave 2) — ensure present after pull
python -c "import multipart" 2>/dev/null || pip install -q 'python-multipart>=0.0.20' aiosqlite
[ -f alembic.ini ] && alembic upgrade head 2>/dev/null || true
uvicorn app.main:app --reload --port "${API_PORT}" &
BACK_PID=$!

echo "Expo :${EXPO_PORT} (preview по умолчанию, без лишней вкладки)..."
cd "${ROOT}/apps/mobile"
export BROWSER=none
npx expo start --web --port "${EXPO_PORT}" --clear &
EXPO_PID=$!

echo "Жду API, Metro и preview-страницу..."
READY=0
for i in $(seq 1 45); do
  if curl -sf "http://127.0.0.1:${API_PORT}/health" >/dev/null && \
     curl -sf "http://127.0.0.1:${EXPO_PORT}/iphone-preview.html" >/dev/null && \
     curl -sf "http://127.0.0.1:${EXPO_PORT}/" >/dev/null; then
    READY=1
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  OK  API:     http://127.0.0.1:${API_PORT}"
    echo "  OK  Preview: ${PREVIEW_URL}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    break
  fi
  sleep 2
done

if [ "$READY" -eq 0 ]; then
  echo "WARN: серверы ещё стартуют — preview откроется, когда будет готов"
fi

if [ "${OPEN_PREVIEW:-1}" = "1" ]; then
  bash "${ROOT}/scripts/open-iphone-preview.sh" || true
fi

echo "PIDs: backend=${BACK_PID} expo=${EXPO_PID}"
echo "Повторно открыть preview: npm run preview"
wait
