#!/usr/bin/env bash
set -euo pipefail
PLIST_DST="$HOME/Library/LaunchAgents/com.renova.sync.plist"
UID_VAL="$(id -u)"
launchctl bootout "gui/$UID_VAL" "$PLIST_DST" 2>/dev/null || true
rm -f "$PLIST_DST"
echo "Агент com.renova.sync удалён"
