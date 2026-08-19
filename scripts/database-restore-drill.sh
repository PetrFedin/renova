#!/usr/bin/env bash
set -euo pipefail

POSTGRES_IMAGE="${POSTGRES_IMAGE:?POSTGRES_IMAGE is required}"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5436}"
PGUSER="${PGUSER:-renova}"
PGPASSWORD="${PGPASSWORD:?PGPASSWORD is required}"
SOURCE_DB="${SOURCE_DB:-renova}"
RESTORE_DB="${RESTORE_DB:-renova_restore}"
DR_DIR="${DR_DIR:?DR_DIR is required}"

[[ "$SOURCE_DB" != "$RESTORE_DB" ]] || {
  echo "FAIL: restore target must differ from source database" >&2
  exit 1
}
[[ "$RESTORE_DB" == "renova_restore" ]] || {
  echo "FAIL: restore drill target must be the isolated renova_restore database" >&2
  exit 1
}

mkdir -p "$DR_DIR"
dump_path="$DR_DIR/renova.dump"
list_path="$DR_DIR/dump-list.txt"
rm -f "$dump_path" "$list_path"

run_pg() {
  docker run --rm --network host \
    -e PGPASSWORD="$PGPASSWORD" \
    "$POSTGRES_IMAGE" "$@"
}

run_pg pg_dump \
  -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$SOURCE_DB" \
  --format=custom --compress=9 --no-owner --no-privileges \
  --file=/tmp/renova.dump

# Copy the dump out without printing its contents.
container_id="$(docker create "$POSTGRES_IMAGE")"
trap 'docker rm -f "$container_id" >/dev/null 2>&1 || true' EXIT
docker cp /dev/null "$container_id:/tmp/.keep" >/dev/null 2>&1 || true
docker rm -f "$container_id" >/dev/null 2>&1 || true
trap - EXIT

# Re-run pg_dump with an explicit bind mount so the file never crosses stdout.
docker run --rm --network host \
  -e PGPASSWORD="$PGPASSWORD" \
  -v "$DR_DIR:/backup" \
  "$POSTGRES_IMAGE" \
  pg_dump \
    -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$SOURCE_DB" \
    --format=custom --compress=9 --no-owner --no-privileges \
    --file=/backup/renova.dump

test -s "$dump_path"
docker run --rm \
  -v "$DR_DIR:/backup:ro" \
  "$POSTGRES_IMAGE" \
  pg_restore --list /backup/renova.dump > "$list_path"

grep -q "TABLE DATA public users" "$list_path"
grep -q "TABLE DATA public projects" "$list_path"
grep -q "TABLE DATA public stages" "$list_path"

run_pg createdb \
  -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -O "$PGUSER" "$RESTORE_DB"

docker run --rm --network host \
  -e PGPASSWORD="$PGPASSWORD" \
  -v "$DR_DIR:/backup:ro" \
  "$POSTGRES_IMAGE" \
  pg_restore \
    -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$RESTORE_DB" \
    --exit-on-error --no-owner --no-privileges \
    /backup/renova.dump

restored_db="$(run_pg psql -At -v ON_ERROR_STOP=1 \
  -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$RESTORE_DB" \
  -c 'SELECT current_database()')"
[[ "$restored_db" == "$RESTORE_DB" ]] || {
  echo "FAIL: restore verification connected to unexpected database: $restored_db" >&2
  exit 1
}

echo "database restore drill native phase: PASS target=$RESTORE_DB"
