#!/usr/bin/env bash
# Установка launchd: каждые 60 сек renova → renova-os
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OS="$(dirname "$ROOT")/renova-os"
PLIST_DST="$HOME/Library/LaunchAgents/com.renova.sync.plist"
UID_VAL="$(id -u)"

cat > "$PLIST_DST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.renova.sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$ROOT/scripts/sync-renova-os.sh</string>
    <string>to-os</string>
  </array>
  <key>StartInterval</key>
  <integer>60</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$OS/.sync.log</string>
  <key>StandardErrorPath</key>
  <string>$OS/.sync.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$UID_VAL" "$PLIST_DST" 2>/dev/null || true
launchctl bootstrap "gui/$UID_VAL" "$PLIST_DST"
echo "Установлено: $PLIST_DST"
echo "Лог: $OS/.sync.log"
