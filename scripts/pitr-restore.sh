#!/usr/bin/env bash
# PITR restore: pg_restore --target-time "2026-01-01 12:00:00"
set -euo pipefail
TARGET="${1:?usage: pitr-restore.sh TIMESTAMP}"
echo "Stop app, restore base backup, replay WAL to $TARGET"
pg_restore -d renova_restore /backups/latest.dump
echo "Manual: recovery_target_time=$TARGET in recovery.conf"
