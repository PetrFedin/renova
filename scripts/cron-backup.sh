#!/usr/bin/env bash
# 0 3 * * * /path/scripts/cron-backup.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
bash "$DIR/backup.sh"
