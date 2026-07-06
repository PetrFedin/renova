#!/usr/bin/env bash
# Синхронизация рабочей копии renova ↔ git-зеркало renova-os (GitHub)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${RENOVA_SRC:-$ROOT}"
OS="${RENOVA_OS:-$(dirname "$ROOT")/renova-os}"
DEBOUNCE_SEC="${RENOVA_SYNC_DEBOUNCE:-2}"

RSYNC_EXCLUDES=(
  --exclude node_modules
  --exclude .expo
  --exclude dist
  --exclude backend/.venv
  --exclude backend/__pycache__
  --exclude backend/logs
  --exclude backend/renova.db
  --exclude .pytest_cache
  --exclude test-results
  --exclude coverage
  --exclude .env
  --exclude .DS_Store
  --exclude .git
  --exclude renova
  --exclude '*.pyc'
)

log() { printf '[sync-renova-os] %s\n' "$*"; }

require_dirs() {
  [[ -d "$SRC" ]] || { log "ERROR: источник не найден: $SRC"; exit 1; }
  [[ -d "$OS" ]] || { log "ERROR: зеркало не найдено: $OS"; exit 1; }
}

sync_to_os() {
  require_dirs
  log "renova → renova-os"
  rsync -a --delete "${RSYNC_EXCLUDES[@]}" "$SRC/" "$OS/"
  log "готово: $OS"
}

sync_from_os() {
  require_dirs
  log "renova-os → renova (без --delete, node_modules сохраняются)"
  rsync -a "${RSYNC_EXCLUDES[@]}" "$OS/" "$SRC/"
  log "готово: $SRC"
}

sync_both() {
  sync_to_os
  sync_from_os
}

show_status() {
  require_dirs
  log "SRC: $SRC"
  log "OS:  $OS"
  if command -v rsync >/dev/null 2>&1; then
    log "--- diff (renova → renova-os, dry-run) ---"
    rsync -avnc --delete "${RSYNC_EXCLUDES[@]}" "$SRC/" "$OS/" | tail -20 || true
  fi
}

git_push_os() {
  require_dirs
  sync_to_os
  if [[ ! -d "$OS/.git" ]]; then
    log "ERROR: $OS не git-репозиторий"
    exit 1
  fi
  (
    cd "$OS"
    if git diff --quiet && git diff --cached --quiet; then
      log "нет изменений для commit"
    else
      git add -A
      git commit -m "${RENOVA_SYNC_COMMIT_MSG:-sync: обновление из renova $(date '+%Y-%m-%d %H:%M')}"
    fi
    git push origin main
  )
  log "GitHub обновлён"
}

watch_to_os() {
  require_dirs
  STAMP="$OS/.sync-last"
  touch "$STAMP"
  log "watch: renova → renova-os (poll ${DEBOUNCE_SEC}s, Ctrl+C для остановки)"
  while true; do
    if find "$SRC" -type f -newer "$STAMP" \
      ! -path '*/node_modules/*' \
      ! -path '*/.expo/*' \
      ! -path '*/backend/.venv/*' \
      ! -path '*/.git/*' \
      ! -path '*/backend/logs/*' \
      ! -name '.env' \
      2>/dev/null | head -1 | grep -q .; then
      sleep "$DEBOUNCE_SEC"
      sync_to_os
      touch "$STAMP"
    fi
    sleep "$DEBOUNCE_SEC"
  done
}

usage() {
  cat <<EOF
Использование: $(basename "$0") <команда>

  to-os      Синхронизировать renova → renova-os (основной режим разработки)
  from-os    Синхронизировать renova-os → renova (после git pull)
  both       to-os, затем from-os
  status     Показать отличия (dry-run)
  push       to-os + git commit + push в GitHub
  watch      Poll: автосинхронизация renova → renova-os

Переменные: RENOVA_SRC, RENOVA_OS, RENOVA_SYNC_DEBOUNCE, RENOVA_SYNC_COMMIT_MSG
EOF
}

cmd="${1:-to-os}"
case "$cmd" in
  to-os) sync_to_os ;;
  from-os) sync_from_os ;;
  both) sync_both ;;
  status) show_status ;;
  push) git_push_os ;;
  watch) watch_to_os ;;
  -h|--help|help) usage ;;
  *) log "неизвестная команда: $cmd"; usage; exit 1 ;;
esac
