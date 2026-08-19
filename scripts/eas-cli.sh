#!/usr/bin/env bash
set -euo pipefail

# EAS CLI is intentionally not installed into project dependencies: Expo
# recommends enforcing the project version through eas.json instead. Keep this
# exact version in sync with apps/mobile/eas.json and the release-integrity gate.
EAS_CLI_VERSION="21.4.0"

exec npx --yes "eas-cli@${EAS_CLI_VERSION}" "$@"
