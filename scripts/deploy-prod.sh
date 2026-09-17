#!/usr/bin/env bash
# NOT a production deployment. Kept because removing it would silently break
# anything that still calls it; it now refuses instead of doing damage.
#
# What this script used to do:
#
#     export DATABASE_URL="${DATABASE_URL:-postgresql+asyncpg://renova:renova@localhost:5433/renova}"
#     cd backend && source .venv/bin/activate
#     alembic upgrade head
#     uvicorn app.main:app --host 0.0.0.0 --port 8100
#
# That is a developer shortcut wearing a production name: a local virtualenv
# instead of the immutable image, default credentials baked into the default,
# no reverse proxy, no --proxy-headers, migration and serving fused into one
# process, no health gate and no rollback path.
#
# The real path is infra/staging/ — same immutable image as production, pinned
# by digest, migrate as a one-shot, api and worker as separate roles.
set -euo pipefail

cat >&2 <<'MESSAGE'
refusing: scripts/deploy-prod.sh is not a deployment.

It ran uvicorn from a local virtualenv with default credentials. Use the
documented topology instead:

    infra/staging/docker-compose.yml   (see infra/staging/README.md)

Production promotion additionally requires the external gates tracked in
PRODUCTION-READINESS.md (#233 environment, #234 backup/PITR, #237 security
acceptance). A compose file does not close them.

To run the API locally, use the canonical local runtime:

    npm run dev
MESSAGE

exit 1
