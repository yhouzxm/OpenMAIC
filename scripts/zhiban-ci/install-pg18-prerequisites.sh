#!/usr/bin/env bash
# Dedicated manual GitHub VM only. PG16 constructs the independent import reference;
# the application target, physical backup and restore use PG18 exclusively.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true && "${GITHUB_EVENT_NAME:-}" == workflow_dispatch ]]
[[ "${PG18_DEB_VERSION:-}" == 18.6-1.pgdg24.04+2 ]]
bash scripts/zhiban-ci/install-portable-prerequisites.sh
sudo apt-get install -y --allow-downgrades --no-install-recommends \
  "postgresql-18=$PG18_DEB_VERSION" "postgresql-client-18=$PG18_DEB_VERSION" openssl
[[ "$(dpkg-query -W -f='${Version}' postgresql-18)" == "$PG18_DEB_VERSION" ]]
[[ "$(dpkg-query -W -f='${Version}' postgresql-client-18)" == "$PG18_DEB_VERSION" ]]
/usr/lib/postgresql/18/bin/postgres --version
