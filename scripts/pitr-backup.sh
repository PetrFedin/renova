#!/usr/bin/env bash
# PITR: настрой WAL archiving в prod
set -euo pipefail
echo "archive_mode=on archive_command='test ! -f /wal_archive/%f && cp %p /wal_archive/%f'" >> postgresql.conf
