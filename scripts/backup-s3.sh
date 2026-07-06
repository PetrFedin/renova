#!/usr/bin/env bash
set -euo pipefail
FILE="${1:-backup-$(date +%Y%m%d).sql.gz}"
pg_dump "${DATABASE_URL/postgresql+asyncpg/postgresql}" | gzip > "/tmp/$FILE"
aws s3 cp "/tmp/$FILE" "s3://${S3_BACKUP_BUCKET:-renova-backups}/$FILE" 2>/dev/null || cp "/tmp/$FILE" "./backups/$FILE"
echo "backup: $FILE"
