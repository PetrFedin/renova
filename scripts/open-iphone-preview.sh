#!/usr/bin/env bash
# Открывает iPhone preview в отдельном окне Chrome (или системном браузере)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXPO_PORT="${EXPO_PORT:-8081}"
PREVIEW_URL="http://127.0.0.1:${EXPO_PORT}/iphone-preview.html"
MAX_WAIT="${PREVIEW_WAIT_SEC:-60}"


# Автозапуск Expo web, если Metro не поднят
if ! curl -sf "http://127.0.0.1:${EXPO_PORT}/" >/dev/null 2>&1; then
  echo "Metro не запущен — стартуем Expo web :${EXPO_PORT}..."
  cd "${ROOT}/apps/mobile"
  export BROWSER=none
  npx expo start --web --port "${EXPO_PORT}" --clear >/tmp/renova-expo.log 2>&1 &
  EXPO_AUTO_PID=$!
  echo "Expo PID: ${EXPO_AUTO_PID} (лог: /tmp/renova-expo.log)"
  cd "${ROOT}"
fi

echo "Жду preview: ${PREVIEW_URL}"
for i in $(seq 1 "$MAX_WAIT"); do
  if curl -sf "${PREVIEW_URL}" >/dev/null 2>&1 && \
     curl -sf "http://127.0.0.1:${EXPO_PORT}/" >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq "$MAX_WAIT" ]; then
    echo "Preview не готов. Запустите: npm run dev"
    exit 1
  fi
  sleep 1
done

if [ -d "/Applications/Google Chrome.app" ]; then
  open -na "Google Chrome" --args \
    --app="${PREVIEW_URL}" \
    --window-size=430,920 \
    --window-position=100,50 \
    --new-window
  echo "OK: iPhone preview → ${PREVIEW_URL}"
  exit 0
fi

open "${PREVIEW_URL}"
echo "OK: iPhone preview → ${PREVIEW_URL}"
