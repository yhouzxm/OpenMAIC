#!/usr/bin/env bash
# Runs only inside the approved disposable GitHub Ubuntu VM. Never a local installer.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true && "${GITHUB_EVENT_NAME:-}" == workflow_dispatch ]]
[[ "$(. /etc/os-release && printf '%s' "$VERSION_CODENAME")" == noble ]]
[[ "$(dpkg --print-architecture)" == amd64 ]]
[[ "${PG16_DEB_VERSION:-}" == 16.15-1.pgdg24.04+2 ]]
sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends ca-certificates curl gnupg libnss3-tools ripgrep postgresql-common
key_file="${RUNNER_TEMP}/zhiban-pgdg-key.asc"
curl --fail --silent --show-error --proto '=https' --tlsv1.2 https://www.postgresql.org/media/keys/ACCC4CF8.asc -o "$key_file"
key_fingerprint="$(gpg --batch --show-keys --with-colons "$key_file" 2>/dev/null | awk -F: '$1=="fpr"{print $10; exit}')"
[[ "$key_fingerprint" == B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8 ]]
sudo install -d /usr/share/postgresql-common/pgdg
sudo install -m 0644 "$key_file" /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
# The official helper prefers an existing .gpg keyring; validate that key too.
existing_keyring=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg
if [[ -f "$existing_keyring" ]]; then
  existing_fingerprint="$(gpg --batch --show-keys --with-colons "$existing_keyring" 2>/dev/null | awk -F: '$1=="fpr"{print $10; exit}')"
  [[ "$existing_fingerprint" == B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8 ]]
fi
# Reuse/normalize the canonical PGDG source instead of creating conflicting Signed-By entries.
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y noble
# Never substitute a newer minor or rewrite the physical-backup profile if unavailable.
sudo apt-get install -y --allow-downgrades --no-install-recommends "postgresql-16=$PG16_DEB_VERSION" "postgresql-client-16=$PG16_DEB_VERSION"
[[ "$(dpkg-query -W -f='${Version}' postgresql-16)" == "$PG16_DEB_VERSION" ]]
[[ "$(dpkg-query -W -f='${Version}' postgresql-client-16)" == "$PG16_DEB_VERSION" ]]
/usr/lib/postgresql/16/bin/postgres --version
rm -f "$key_file"
